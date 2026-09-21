# opencode-jev-plugin

OpenCode plugin adding automated, Jev-powered guardrails: every bash command and
user message is screened (TypeSafe Jev `noul` battery + severity `score`), and
hazardous ones are escalated to the OpenCode permission prompt so you decide.
Jev failure of any kind → fail-open: work is never blocked by a broken screen.

The plugin also registers a **`jev_ask` tool (enabled by default)** so any
agent or model in a session can ask the Jev decision model directly: typed
answers with calibrated probabilities (yes/no, choice, ordinal score), batched
into one HTTP call per invocation.

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

Every consumer of Jev — guardrails hooks and the `jev_ask` tool — goes through
one shared ask engine (`src/ask/engine.ts`): one client, one timeout/retry
policy, one answer parser, one audit log.

## Install

```sh
cd ~/Sites/korbeil/opencode-jev-plugin
nvm use        # .nvmrc pins Node 24
npm install    # dev dependencies only (typescript, vitest, biome)
npm run check  # typecheck + lint + tests
```

The plugin itself has **zero runtime dependencies** in its source (plain
`fetch`, Node 20+); the `@opencode-ai/plugin` package is a devDependency used
only to build the `jev_ask` tool definition and types.

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
        "modules": { "guardrails": true, "tool": true },
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
| `jev_ask` tool | **default on** (`"modules": { "tool": true }`) — set `false` to hide the tool from agents |
| model routing | **not yet implemented** — see `spec/SPEC.md` |
| compaction | **not yet implemented** — see `spec/SPEC.md` |

## The `jev_ask` tool (enabled by default)

Any agent/model can call `jev_ask` to get typed Jev decisions. It becomes
available to **all** agents, including `plan` mode and subagents; to restrict
it, set `"modules": { "tool": false }` or use per-agent `permission` rules in
your own config.

```jsonc
// tool arguments
{
  "state": "text or JSON to judge, trimmed and well under 32K tokens",
  // EITHER inline questions:
  "questions": {
    "refund": { "type": "noul", "instructions": "…",
                "criteria": { "true": "…", "false": "…" } },
    "topic":   { "type": "choice", "instructions": "…",
                 "criteria": { "billing": "…", "bug": "…" } },
    "urgency": { "type": "score", "instructions": "…",
                 "criteria": ["can wait", "today", "now"] }
  }
  // OR a saved spec:
  "spec": "route"          // ~/.config/jev/specs/<name>.json, or a path to a .json file
}
```

- One batched call per invocation: all named questions are answered by Jev in a
  single HTTP request.
- Plain-text result, one line per question: `name: yes (p=0.97)` /
  `name: code (confidence=0.80)` / `name: 2` for a score.
- **Fail-visible**: unlike the guardrails' fail-open, a Jev error returns an
  explicit `jev_ask could not run: <reason>` so the model can adapt or retry.
- Question validation is strict (same rules as the okooo5km `jev` CLI specs):
  unknown fields are rejected before the request; `noul` criteria need both
  sides; `choice` needs ≥2 options; `score` 2–10 labels low→high.
- Every call is logged to the shared audit log (`kind: "tool"`).
- Costs a network call per invocation (~$0.00002); the model is told to batch
  questions via the tool description.

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
├── index.ts          # plugin factory + hook wiring (guardrails + tool, module flags)
├── jev.ts            # HTTP client (+ retry/timeout, question/answer models)
├── logger.ts         # JSONL audit log
├── config.ts         # options resolution/validation
├── ask/              # shared Jev ask engine — one call path for every consumer
│   └── engine.ts     # askJev(): ok/answers|reason + elapsed, callers log
├── asktool/          # jev_ask tool (LLM-facing surface of the engine)
│   ├── ask.ts        # tool definition (args, execute, answer formatting)
│   ├── questions.ts  # inline question validation (noul/choice/score)
│   └── spec.ts       # spec loading (~/.config/jev/specs or explicit path)
├── common/           # shared runtime helpers — guards · format
├── types/            # shared type declarations (jev, config, screening)
└── guardrails/       # battery.ts · decision.ts · prefilters.ts · screen.ts
```

`src/routing/` (battery · decision · cache · route) and `src/compaction/`
(battery · decision · transcript · compact) will follow the same shape once
implemented, call `src/ask/engine.ts` for every Jev call (the same engine the
`jev_ask` tool and the guardrails use) and reuse `src/common/` instead of
duplicating it; the README sections above are the source of truth for their
numbers until then.

## Roadmap

The `jev_ask` tool (default on) is shipped; tiered model routing (a `routing`
config object) and context compaction (a `modules.compaction` boolean) are
documented above and specified in `spec/SPEC.md`; both are intentionally absent
from the code for now.
