import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_POLICIES } from "../src/config.ts";
import type { GuardrailsDependencies } from "../src/guardrails/screen.ts";
import type { JevAnswers, JevQuestions, JevState } from "../src/jev.ts";
import type { GuardrailsLogger, LogEntry } from "../src/logger.ts";
import type { PolicyName } from "../src/types/config.ts";

const POLICIES = DEFAULT_POLICIES;
type DepsPolicyName = PolicyName;

interface FakeJev {
  calls: number;
  asks: { state: JevState; questions: JevQuestions }[];
}

export interface DepsOptions {
  answers?: Record<string, number>;
  payload?: unknown;
  failOnCall?: boolean;
  policyName?: DepsPolicyName;
}

export interface DepsWithJev extends GuardrailsDependencies {
  jev: FakeJev;
  log: LogEntry[];
}

export function makeDeps(options: DepsOptions = {}): DepsWithJev {
  const jev: FakeJev = { calls: 0, asks: [] };
  const log: LogEntry[] = [];
  const deps: DepsWithJev = {
    jev,
    log,
    client: {
      ask: async <Q extends Partial<JevQuestions>>(
        state: JevState,
        questions: Q,
      ): Promise<JevAnswers<Required<Q>>> => {
        jev.calls++;
        jev.asks.push({ state, questions: questions as JevQuestions });
        if (options.failOnCall) throw new Error("Jev network error: unavailable");
        const rawAnswers = options.payload ?? options.answers;
        if (rawAnswers === undefined) throw new Error("Jev returned a malformed response");
        const out: Record<string, number> = {};
        for (const name of Object.keys(questions)) {
          const value = (rawAnswers as Record<string, unknown>)[name];
          if (typeof value !== "number") {
            throw new Error(`Jev answer "${name}" is missing or out of range`);
          }
          out[name] = value;
        }
        return out as JevAnswers<Required<Q>>;
      },
    },
    logger: {
      record: async (entry) => {
        log.push(entry);
      },
      warn: async (message) => {
        log.push({
          ts: "0",
          tool: "plugin",
          decision: "warn",
          policy: "none",
          elapsedMs: 0,
          cached: false,
          warn: message,
        });
      },
    } satisfies GuardrailsLogger,
    policyName: options.policyName ?? "strict",
    policies: POLICIES,
  };
  return deps;
}

export const tmpLogFile = (name: string) => path.join(tmpdir(), `jev-test-${name}.log`);
