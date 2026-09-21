import { describe, expect, it } from "vitest";
import { askJev } from "../src/ask/engine.ts";
import type { JevAsker, JevQuestions, JevState } from "../src/jev.ts";

const QUESTIONS = {
  hazard: { type: "noul" },
  level: { type: "score", min: 0, max: 3 },
} satisfies JevQuestions;

const STATE: JevState = { tool: "bash", text: "hello" };

function fakeClient(answer: unknown, error?: string): JevAsker & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async ask(state: JevState, questions: JevQuestions) {
      calls++;
      expect(state).toEqual(STATE);
      expect(Object.keys(questions)).toEqual(Object.keys(QUESTIONS));
      if (error) throw new Error(error);
      return {
        hazard: { probability: (answer as { p: number }).p },
        level: { value: (answer as { v: number }).v },
      } as never;
    },
  } as JevAsker & { calls: number };
}

describe("askJev (shared ask engine)", () => {
  it("returns ok with answers and elapsed time", async () => {
    const client = fakeClient({ p: 0.42, v: 1 });
    const result = await askJev(client, STATE, QUESTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.answers).toEqual({
        hazard: { probability: 0.42 },
        level: { value: 1 },
      });
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    }
    expect(client.calls).toBe(1);
  });

  it("returns a structured failure (never throws) when Jev is unreachable", async () => {
    const client = fakeClient(undefined, "Jev network error: down");
    const result = await askJev(client, STATE, QUESTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("Jev network error: down");
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    }
    expect(client.calls).toBe(1);
  });
});
