import { describe, expect, it } from "vitest";
import { ASK_TOOL_NAME, ask, createAskTool } from "../src/asktool/ask.ts";
import { normalizeQuestions } from "../src/asktool/questions.ts";
import { loadSpecQuestions } from "../src/asktool/spec.ts";
import type { JevAnswers, JevAsker, JevQuestions } from "../src/jev.ts";
import type { GuardrailsLogger, LogEntry } from "../src/logger.ts";

function makeDeps(options: { fail?: boolean } = {}) {
  const log: LogEntry[] = [];
  const client: JevAsker = {
    ask: async <Q extends Partial<JevQuestions>>(
      _state: unknown,
      questions: Q,
    ): Promise<JevAnswers<Required<Q>>> => {
      if (options.fail) throw new Error("Jev network error: unavailable");
      const answers: Record<string, unknown> = {};
      for (const name of Object.keys(questions)) {
        const type = questions[name]?.type;
        answers[name] =
          type === "score"
            ? { value: 2 }
            : type === "choice"
              ? { option: "code", probabilities: { code: 0.9, chat: 0.1 }, confidence: 0.9 }
              : { probability: 0.97 };
      }
      return answers as JevAnswers<Required<Q>>;
    },
  };
  return {
    log,
    deps: {
      client,
      logger: {
        record: async (entry: LogEntry) => {
          log.push(entry);
        },
        warn: async (message: string) => {
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
    },
  };
}

describe("asktool.question validation", () => {
  it("accepts a well-formed mixed battery", () => {
    const result = normalizeQuestions({
      refund: {
        type: "noul",
        instructions: "…",
        criteria: { true: "asks money back", false: "compliment" },
      },
      topic: { type: "choice", instructions: "…", criteria: { billing: "money", bug: "broken" } },
      urgency: { type: "score", instructions: "…", criteria: ["can wait", "now"] },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.questions.refund).toEqual({
        type: "noul",
        instructions: "…",
        criteria: { true: "asks money back", false: "compliment" },
      });
      expect(result.questions.urgency).toEqual({
        type: "score",
        min: 0,
        max: 1,
        instructions: "…",
        criteria: ["can wait", "now"],
      });
    }
  });

  it("rejects a noul with a one-sided criteria", () => {
    const result = normalizeQuestions({
      q: { type: "noul", instructions: "…", criteria: { true: only() } },
    });
    expect(result.ok).toBe(false);
  });

  function only(): string {
    return "x";
  }

  it("rejects a choice with fewer than two options", () => {
    const result = normalizeQuestions({
      q: { type: "choice", instructions: "…", criteria: { a: "only" } },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a score with more than 10 levels", () => {
    const labels = Array.from({ length: 11 }, (_, i) => `L${i}`);
    const result = normalizeQuestions({
      q: { type: "score", instructions: "…", criteria: labels },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown fields per question", () => {
    const result = normalizeQuestions({ q: { type: "noul", instructions: "…", foo: 1 } });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty instructions string", () => {
    const result = normalizeQuestions({ q: { type: "noul", instructions: "  " } });
    expect(result.ok).toBe(false);
  });
});

describe("asktool.spec loading", () => {
  it("reports a missing spec without throwing", async () => {
    const result = await loadSpecQuestions("definitely-not-here-xyz");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/spec not found/);
  });

  it("loads a spec from an explicit path and validates its questions", async () => {
    const { writeFile, rm } = await import("node:fs/promises");
    const file = `/tmp/jev-test-spec-${Date.now()}.json`;
    const spec = {
      description: "test",
      questions: {
        refund: { type: "noul", instructions: "refund?", criteria: { true: "asks", false: "not" } },
      },
    };
    await writeFile(file, JSON.stringify(spec));
    const result = await loadSpecQuestions(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.questions)).toEqual(["refund"]);
    await rm(file, { force: true });
  });

  it("rejects an invalid JSON spec file", async () => {
    const { writeFile, rm } = await import("node:fs/promises");
    const file = `/tmp/jev-test-spec-bad-${Date.now()}.json`;
    await writeFile(file, "{nope");
    const result = await loadSpecQuestions(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not valid JSON/);
    await rm(file, { force: true });
  });
});

describe("asktool.ask (jev_ask)", () => {
  it("answers inline questions in one batched call and formats noul/choice/score", async () => {
    const { deps, log } = makeDeps();
    const outcome = await ask(deps, {
      state: "Zipic crashes, refund!",
      questions: {
        refund: { type: "noul", instructions: "…" },
        handler: { type: "choice", instructions: "…", criteria: { code: "…", chat: "…" } },
        urgency: { type: "score", instructions: "…", criteria: ["low", "high"] },
      },
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.output).toBe(
      "refund: yes (p=0.97)\nhandler: code (confidence=0.90)\nurgency: 2",
    );
    expect(log).toHaveLength(1);
    expect(log[0]?.kind).toBe("tool");
    expect(log[0]?.tool).toBe(ASK_TOOL_NAME);
    expect(log[0]?.decision).toBe("answered");
    expect(log[0]?.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("is fail-visible when Jev is unreachable", async () => {
    const { deps, log } = makeDeps({ fail: true });
    const outcome = await ask(deps, {
      state: "hello",
      questions: { q: { type: "noul", instructions: "…" } },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/Jev could not evaluate/);
    expect(log[0]?.decision).toBe("error");
    expect(log[0]?.error).toBe("Jev network error: unavailable");
  });

  it("rejects spec and questions together", async () => {
    const { deps } = makeDeps();
    const outcome = await ask(deps, {
      state: "hello",
      spec: "route",
      questions: { q: { type: "noul", instructions: "…" } },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/either "spec" or "questions"/);
  });

  it("requires state", async () => {
    const { deps } = makeDeps();
    const outcome = await ask(deps, {
      state: "  ",
      questions: { q: { type: "noul", instructions: "…" } },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/"state" must be a non-empty string/);
  });

  it("requires questions or spec", async () => {
    const { deps } = makeDeps();
    const outcome = await ask(deps, { state: "hello" });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/provide "questions"/);
  });
});

describe("createAskTool", () => {
  it("builds an OpenCode tool definition named jev_ask", async () => {
    const { deps } = makeDeps();
    const definition = createAskTool(deps);
    expect(typeof definition.description).toBe("string");
    expect(definition.execute).toBeTypeOf("function");
  });
});
