# opencode-jev-plugin

OpenCode plugin adding automated, Jev-powered guardrails: every bash command and
user message is screened (TypeSafe Jev `noul` battery + severity `score`), and
hazardous ones are escalated to the OpenCode permission prompt so you decide.
Jev failure of any kind → fail-open: work is never blocked by a broken screen.

Optional, opt-in features are specified but **not yet implemented**:

- **model routing** — planned, specified in `spec/SPEC.md`
- **context compaction** — planned, specified in `spec/SPEC.md`

## Why

LLM coding agents run shell commands autonomously and process arbitrary user
input. Guardrails based on generated text are themselves serializable junk;
Jev, TypeSafe's System One model, returns calibrated probabilities from a
structured state. That means:

- source of truth = threshold comparisons on probabilities (cheap, predictable);
- one **batched** HTTP request per screened item (all hazards + severity);
- deterministic pre-filters (regex) short-circuit obvious hazards at zero cost.

## Install

```sh
cd ~/Sites/korbeil/opencode-jev-plugin
nvm use        # .nvmrc pins Node 24
npm install    # dev dependencies only (typescript, vitest, biome)
npm run check  # typecheck + lint + tests
```

The plugin itself has **zero runtime dependencies** (plain `fetch`, Node 20+).

## Configure in OpenCode

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "~/Sites/korbeil/opencode-jev-plugin/src/index.ts",
      {
        "apiKey": "apikey_...",
        "model": "jev-latest",
        "policy": "strict",
        "policies": { "strict": {"action": 0.7, "review": 0.35, "severityBlock": 2.0},
                      "permissive": {"action": 0.85, "review": 0.35, "severityBlock": 2.0} },
        "modules": { "guardrails": true },
        "timeoutMs": 2000
      }
    ]
  ]
}
```

Fully quit **and restart** OpenCode: plugin configuration is not hot-reloaded.
The `apiKey` value is sensitive; never commit it, never enable `share` on
sessions, rotate regularly.

### Enabling rules

| Feature | Enabled when |
|---|---|
| guardrails | default on (`"modules": { "guardrails": true }`) |
| model routing | **not yet implemented** — see `spec/SPEC.md` |
| compaction | **not yet implemented** — see `spec/SPEC.md` |

## Reference — defaults & numbers

### Jev HTTP client (all features)

| Setting | Default | Notes |
|---|---|---|
| endpoint | `https://api.typesafe.ai/v1/systemone` | `Authorization: Bearer <apiKey>` |
| `timeoutMs` | `2000` | aborts each attempt after this delay; must be > 0 |
| retries | 2 attempts | only on HTTP **429 / 529**, 150 ms backoff between; other statuses, network errors and timeouts fail immediately |

Any failure (network error, timeout, malformed JSON, missing or out-of-range
answer) is treated as *cannot evaluate* → **fail-open**: work continues, a
`warn` entry is logged.

### Guardrails — always screened

- **Battery** (one batched call per item): nouls `destructive_command`,
  `secret_exfiltration`, `prompt_injection`, `credentials_access` plus a
  `severity` score on **0–3**.
- **Prefilter** (bash only, deterministic, probability 1.00, no Jev call):
  `rm` with recursive+force flags / `--no-preserve-root`, `curl|wget … | sh`,
  reads of `~/.ssh`, `id_rsa`/`id_ed25519`/`id_ecdsa`, `.aws/credentials`,
  `.netrc`, `.git-credentials`, `.npmrc`.
- **Policies** (default `strict`):

| policy | `action` | `review` | `severityBlock` |
|---|---|---|---|
| `strict` | 0.70 | 0.35 | 2.0 |
| `permissive` | 0.85 | 0.35 | 2.0 |

- **Decision ladder**: highest noul ≥ `action` **or** severity ≥ `severityBlock`
  → permission **ask** with reason ``Jev guardrails: <hazard> <p 2dp> — <text>``;
  any noul ≥ `review` → pass, annotated + logged; below → pass.
- Prefilter hits escalate deterministically at cost 0; ask paths are identical.
- User messages are screened too, but a `chat.message` hook cannot deny a turn:
  an `ask` outcome is logged as a warning instead of blocking.
- Invalid `apiKey`/options **disable hooks entirely** with a `WARN` — OpenCode
  itself is never crashed by this plugin.

### Model routing — planned, not implemented

Everything below is the **designed** behavior (not yet implemented). It is
specified in `spec/SPEC.md`; do not expect a `routing` config object to have
any effect today.

```jsonc
"routing": {
  "difficultyMax": 10,          // default 10
  "confidence": 0.70,           // noul confidence floor
  "askOnUncertain": true,       // uncertain → permission ask, not a silent switch
  "escalateCapPerHour": 10,     // max model escalations per rolling hour
  "tiers": [
    { "upTo": 2,   "model": "openai/gpt-5-mini" },        // 0–2
    { "upTo": 8,   "model": "anthropic/claude-sonnet-4-5" }, // 2–8
    { "upTo": 10,  "model": "anthropic/claude-opus-4" }   // 8–10
  ]
}
```

- Questions sent on `chat.message`: `intent` (**choice**: coding / explanation /
  ops / conversational), `difficulty` (**score 0–`difficultyMax`**),
  `needs_reasoning` (noul), `hangout` (noul).
- **Tier selection**: boundaries are half-open with an inclusive `upTo`, i.e.
  the example maps difficulty 0–2 → tier 1, 2–8 → tier 2, 8–10 → tier 3.
- **Validation (fatal → routing disabled + WARN)**: at least one tier, strictly
  increasing `upTo`, last tier's `upTo` must equal `difficultyMax`, first implicit
  lower bound 0, non-empty `model` strings.
- **Signal adjustments** (clamp one tier up, never down): `needs_reasoning ≥
  confidence` or `intent = ops` → one tier up; `hangout` never escalates.
- **Uncertainty**: highest noul < `confidence` and the choice's top-option share
  < **0.6** → uncertain; `askOnUncertain` surfaces the switch as a permission
  ask, otherwise nothing changes.
- **Cost guardrail**: decisions cached by (message hash, session) with a
  **5-minute** TTL (classification happens on `chat.message` only);
  `escalateCapPerHour` blocks further model escalations for the rest of the
  hour (falls back to the session model, logged).
- **Fail-open**: any Jev error, timeout, malformed answer or cache miss → the
  `chat.params` hook leaves the session's model untouched.

### Compaction — planned, not implemented

Not implemented yet; the design below is specified in `spec/SPEC.md`.

- `keepThreshold` = **0.5** (three decisions per tool call: `keep` /
  `keep call, truncate result` / `drop`), lowered adaptively for large sessions;
- transcript estimate ceiling **25k tokens**, staged truncation rounds;
- pins: first message + newest N kept, `tool_use`↔`tool_result` paired by id,
  text messages never removed or mutated;
- decision cache keyed by content hash, drift tracking of estimated vs
  Jev-reported tokens;
- fallback to OpenCode's default compaction when the achieved reduction is
  **< 25%** or on any Jev error (fail-open, like everything else).

## Logging

One JSON line per screening, appended to `~/.cache/opencode/jev-guardrails.log`
(override with `JEV_GUARDRAILS_LOG`):

```json
{"ts":"2026-09-18T12:00:00.000Z","tool":"bash","hazard":"destructive_command","probability":0.72,"severity":null,"decision":"ask","policy":"strict","elapsedMs":12,"cached":false}
```

This is the dataset used to retune thresholds over time.

## Development

```sh
nvm use
npm run check     # typecheck + lint + tests
npm test          # vitest, fake Jev transport, no network
npm run fix       # biome autofix
```

Layout — one folder per feature, shared `types/`:

```
src/
├── index.ts          # plugin factory + hook wiring
├── jev.ts            # HTTP client (+ retry/timeout)
├── logger.ts         # JSONL audit log
├── config.ts         # options resolution/validation
├── common/           # shared runtime helpers — guards · format · screened() runner
├── types/            # shared type declarations (jev, config, screening)
└── guardrails/       # battery.ts · decision.ts · prefilters.ts · screen.ts
```

`src/routing/` (battery · decision · cache · route) and `src/compaction/`
(battery · decision · transcript · compact) will follow the same shape once
implemented and reuse `src/common/` instead of duplicating it; the README
sections above are the source of truth for their numbers until then.

## Roadmap

Tiered model routing (a `routing` config object) and context compaction
(a `modules.compaction` boolean) are documented above and specified in
`spec/SPEC.md`; both are intentionally absent from the code for now.
