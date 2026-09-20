# opencode-jev-plugin — specification

OpenCode plugin adding automated, Jev-powered guardrails (bash commands + user
messages), with tiered model routing (phase 2) and Jev-driven context
compaction (phase 3) designed as follow-up features. Inspired by
[`fast-jev-compaction`](https://github.com/tamaratran/fast-jev-compaction),
adapted to and improved by OpenCode's native plugin API.

`README.md` documents the implemented behavior and all default numbers; this
file is the source of truth for decisions, batteries and the not-yet-implemented
phases.

## Background

Jev is TypeSafe's System One model: given a structured `state` and a map of typed
questions it returns calibrated probabilities instead of generated text. The TypeSafe
guardrails cookbook screens every message with a battery of `Noul` (yes/no probability)
questions per hazard plus one `Score` (severity) question, then code thresholds decide
pass / review / block.

| Primitive | Returns | Used for |
|---|---|---|
| `noul` | probability 0..1 that the answer is yes | hazard probabilities, `needs_reasoning`, `hangout` |
| `score` | probability-weighted value across ordered levels | harm severity (0–3); routing difficulty (0–10) |
| `choice` | one option + full distribution | routing `intent` (phase 2) |

## Decisions (locked)

| Setting | Value |
|---|---|
| Jev unreachable / timeout / malformed answer | **fail-open** — warn, never block work |
| Screening scope (phase 1) | **bash tool calls + user messages** |
| Action on high-probability hazard | **escalate to OpenCode permission prompt ("ask")** |
| API key | **file, directly** — via plugin options in `~/.config/opencode/opencode.json`, no env var |
| Roadmap | 1. guardrails (v1, shipped) → 2. tiered model routing (designed, unimplemented) → 3. compaction (designed, unimplemented) |
| Routing difficulty scale | **0–10** score, `difficultyMax` configurable, default **10** |
| Routing enablement | **presence of the `routing` config object**; no `modules.routing` boolean gate |
| Routing tier boundaries | **half-open, inclusive `upTo`**: tier i covers `(prev, upTo]`, first tier covers `[0, upTo]` |
| Routing validation failure | **fatal for the routing module only** (disabled + WARN), remaining thresholds auto-corrected where possible |
| Tier signal adjustments | `needs_reasoning ≥ confidence` or `intent = ops` → one tier **up**; never auto-downgrade |
| Compaction enablement | **boolean only**: `"modules": { "compaction": true }`, default off |

## Layout (current)

```
~/Sites/korbeil/opencode-jev-plugin/
├── spec/SPEC.md                  # this file
├── README.md                     # user-facing docs incl. all default numbers
├── opencode.jsonc                # sample config: plugin wiring + commented phase 2/3 stanzas
├── src/
│   ├── index.ts                  # plugin entry (plugin factory, hook wiring)
│   ├── config.ts                 # validate plugin options, resolve policy
│   ├── jev.ts                    # HTTP client for POST https://api.typesafe.ai/v1/systemone
│   ├── logger.ts                 # appends decision records to a log file
│   ├── common/                   # shared runtime helpers (no duplicates across features)
│   │   ├── guards.ts             # isRecord, finiteNumber, numberInRange
│   │   ├── format.ts             # fixed2, shorten, pickHighest
│   │   └── screening.ts          # screened() — ask→evaluate/fail-open runner with timing
│   ├── types/                    # shared type declarations
│   │   ├── jev.ts                # question/answer/state models
│   │   ├── config.ts             # Policy, PluginConfig, RawPluginOptions, resolve results
│   │   └── screening.ts          # hazards, decisions, severity scale
│   └── guardrails/               # feature folder (one per feature)
│       ├── battery.ts            # hazard noul battery + severity score definitions
│       ├── decision.ts           # threshold math → ask / review / pass
│       ├── prefilters.ts         # regex fast-path for obvious hazards
│       └── screen.ts             # screening orchestration + audit log entries
└── test/                         # vitest suites, fake Jev transport, no network
```

Planned (phase 2/3, same per-feature shape): `src/routing/` (battery · decision ·
cache · route) and `src/compaction/` (battery · decision · transcript · compact),
reusing `src/common/` (guards, reason formatting, the screened() Jev runner,
pickHighest) instead of copying it.

Planned (phase 2/3, same per-feature shape): `src/routing/` (battery · decision ·
cache · route) and `src/compaction/` (battery · decision · transcript · compact).

No runtime dependencies: plain `fetch` (Node 20+), no SDK install.

## Configuration — plugin options

The API key and all settings arrive as the **second tuple element of the plugin entry**
in `~/.config/opencode/opencode.json`. Absolute plugin path makes it work from any
project; defaults and all numeric thresholds are documented in `README.md` and kept
in sync with `src/`, near:

```json
{
  "plugin": [
    ["~/Sites/korbeil/opencode-jev-plugin/src/index.ts", {
      "apiKey": "apikey_...",
      "model": "jev-latest",
      "policy": "strict",
      "policies": {
        "strict":     { "action": 0.70, "review": 0.35, "severityBlock": 2.0 },
        "permissive": { "action": 0.85, "review": 0.35, "severityBlock": 2.0 }
      },
      "modules": { "guardrails": true, "routing": false, "compaction": false },
      "timeoutMs": 2000
    }]
  ]
}
```

- Startup validation: missing/empty `apiKey` or malformed top-level options →
  the plugin disables its hooks and logs a `WARN`; it never hard-crashes OpenCode.
- Per-feature validation failures (malformed `routing`) disable that feature only.
- Unknown option keys are reported once in the log.
- The key lives in `opencode.json` — fine on a personal machine; never enable
  `share` on sessions, never commit or publish that file.

## Jev API usage

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <apiKey>

{ "state": ..., "model": "jev-latest", "questions": { ... } }
```

- One **batched** request per screened item (all questions in one call).
- Retry policy: 2 attempts with a short (150 ms) backoff on `429` / `529` only;
  anything else, including network error and elapsed `timeoutMs` (default 2000), →
  fail-open.
- Responses parsed defensively; a missing or out-of-range answer is treated as
  "cannot evaluate" → fail-open.

## Phase 1 (shipped): guardrails

Battery definitions, prefilter list and the full decision ladder (thresholds
0.70 / 0.35 / 2.0 strict, 0.85 / 0.35 / 2.0 permissive; severity 0–3) are
documented in `README.md` under **Reference — defaults & numbers**.

Hooks: `tool.execute.before` (bash only; prefilter first, then battery), and
`chat.message` (warn + log only — the hook cannot deny a turn). Logging: one
JSON line per screening to `~/.cache/opencode/jev-guardrails.log`
(`{ts, tool, hazard, probability, severity, decision, policy, elapsedMs, cached}`).

## Phase 2 (designed, unimplemented): tiered model routing

Enabled by the **presence of the `routing` config object**. Locked design:

- On `chat.message`, one batched classification call: `intent` (**choice**:
  coding, explanation, ops, conversational), `difficulty` (**score 0–10**,
  `difficultyMax` configurable), `needs_reasoning` (noul), `hangout` (noul),
  over state = last user message + short session context.
- **Difficulty → model via a tier map** — boundaries belong in the config:
  `"tiers": [{ "upTo": 2, "model": "…" }, { "upTo": 8, "model": "…" },
  { "upTo": 10, "model": "…" }]` with `difficultyMax` as the last `upTo` and
  strict validation (increasing, fatal on mismatch).
  Semantics: half-open boundaries, inclusive `upTo` (0–2 includes 2; 2–8 and
  8–10 apply the same rule).
- Signals adjust the tier by one step up only: `needs_reasoning ≥ confidence`
  (default 0.70) or `intent = ops`; `hangout` never escalates.
- On `chat.params`, override `model` from the cached decision; uncertain cases
  (highest noul < `confidence` and choice top-share < 0.6) either trigger a
  permission ask (`askOnUncertain: true`) or fail-open to the session model.
- Cost guardrails: decision cache keyed by (message hash, session), 5-minute
  TTL, classification only on `chat.message`; flagship escalations capped at
  `escalateCapPerHour` (default 10) per rolling hour.
- Fail-open: never override the session's configured model on Jev error.

## Phase 3 (designed, unimplemented): compaction (`experimental.session.compacting`)

Enabled by the **boolean** `"modules": { "compaction": true }` (default off;
sensible defaults otherwise: `keepThreshold` 0.5, adaptive lowering for large
sessions). Method (ported from `fast-jev-compaction`, improved):

- Pin the first message and the newest N; pair every `tool_use` with its
  `tool_result` by id; never remove text messages or mutate kept content.
- State = full transcript with tool results elided, fitted under a 25k-token
  estimate ceiling in staged truncation rounds.
- Batched per-call questions: should the call stay? should the result stay
  verbatim? Three decisions per call: `keep` / `keep call, truncate result`
  / `drop` at `keepThreshold`.
- Decision cache keyed by content hash (retries reuse results) and drift
  tracking between estimated and Jev-reported token usage.
- Fallback to OpenCode's default compaction on < 0.25 reduction or any Jev
  error (fail-open, like everything else).

## Testing / verification

- `npm test` (vitest; Node via nvm, `.nvmrc` pins 24) — unit suites against a
  fake Jev transport: routing math, threshold escalation, pre-filter hits,
  fail-open paths, malformed answers. No network.
- Manual smoke with the real key:
  1. `curl` the endpoint once to confirm auth works.
  2. Restart OpenCode (config is not hot-reloaded): benign command runs silently;
     `rm -rf /tmp/jev-te...`-style command raises the ask prompt; user message
     with an obvious injection gets a warning marker in the log.
  3. Disable network → commands still run, `warn` entries appear (fail-open proof).
- Remember: after every config change, fully quit and restart OpenCode.
