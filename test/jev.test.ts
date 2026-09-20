import { describe, expect, it } from "vitest";
import { JevClient, JevError, parseAnswers } from "../src/jev.ts";

type StubResponse = { ok?: boolean; status: number; json: () => Promise<unknown> };

const QUESTIONS = {
  destructive_command: { type: "noul" } as const,
  severity: { type: "score", min: 0, max: 3 } as const,
};

const STATE = { tool: "bash", text: "ls -la" };

interface Harness {
  ask: (state: typeof STATE) => Promise<Record<string, number>>;
  calls: number[];
  bodies: unknown[];
}

function client(
  transport: (body: unknown) => StubResponse | Promise<StubResponse>,
  options: Partial<{ timeoutMs: number; backoffMs: number; fetchImpl: undefined }> = {},
): Harness {
  const harness: Harness = { ask: undefined as never, calls: [], bodies: [] };
  const impl: typeof fetch = async (_url, init) => {
    harness.calls.push(1);
    harness.bodies.push(init?.body);
    const response = await transport(init != null ? (init as RequestInit).body : undefined);
    return {
      ...response,
      ok: response.ok ?? (response.status >= 200 && response.status < 300),
    } as Response;
  };
  const jev = new JevClient({
    apiKey: "apikey_test",
    timeoutMs: options.timeoutMs ?? 500,
    backoffMs: options.backoffMs ?? 1,
    fetchImpl: impl,
  });
  harness.ask = async (state) => jev.ask(state, QUESTIONS);
  return harness;
}

describe("JevClient.ask", () => {
  it("parses a well-formed response", async () => {
    const c = client(() => ({
      status: 200,
      json: async () => ({
        answers: { destructive_command: { probability: 0.42 }, severity: { value: 1 } },
      }),
    }));
    expect(await c.ask(STATE)).toEqual({ destructive_command: 0.42, severity: 1 });
    expect(c.calls.length).toBe(1);
  });

  it("sends one batched request carrying model, state and questions", async () => {
    const c = client(() => ({
      status: 200,
      json: async () => ({ answers: { destructive_command: 0.1, severity: 1 } }),
    }));
    await c.ask(STATE);
    const body = JSON.parse(String(c.bodies[0])) as Record<string, unknown>;
    expect(body.model).toBe("jev-latest");
    expect(body.state).toEqual(STATE);
    expect(Object.keys(body.questions as Record<string, unknown>)).toEqual([
      "destructive_command",
      "severity",
    ]);
  });

  it("retries once on 429 and succeeds", async () => {
    let n = 0;
    const c = client(() => {
      n++;
      if (n === 1) return { ok: false, status: 429, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ answers: { destructive_command: 0.3, severity: 0 } }),
      };
    });
    expect(await c.ask(STATE)).toEqual({ destructive_command: 0.3, severity: 0 });
    expect(c.calls.length).toBe(2);
  });

  it("fails after a second 429 without a third call", async () => {
    const c = client(() => ({ ok: false, status: 429, json: async () => ({}) }));
    await expect(c.ask(STATE)).rejects.toThrowError(JevError);
    expect(c.calls.length).toBe(2);
  });

  it("does not retry a permanent HTTP error", async () => {
    const c = client(() => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(c.ask(STATE)).rejects.toThrowError(/401/);
    expect(c.calls.length).toBe(1);
  });

  it("fails open on malformed JSON", async () => {
    const c = client(() => ({
      ok: true,
      status: 200,
      json: async () => Promise.reject(new Error("bad json")),
    }));
    await expect(c.ask(STATE)).rejects.toThrowError(JevError);
    expect(c.calls.length).toBe(1);
  });

  it("treats a missing answer as cannot-evaluate", async () => {
    const c = client(() => ({
      ok: true,
      status: 200,
      json: async () => ({ answers: { severity: { value: 1 } } }),
    }));
    await expect(c.ask(STATE)).rejects.toThrowError(/missing or out of range/);
  });

  it("rejects an out-of-range noul", () => {
    expect(() =>
      parseAnswers({ answers: { a: { probability: 1.5 } } }, { a: { type: "noul" } }),
    ).toThrowError(JevError);
  });

  it("rejects a score outside [min, max]", () => {
    expect(() =>
      parseAnswers({ answers: { s: { value: 4 } } }, { s: { type: "score", min: 0, max: 3 } }),
    ).toThrowError(JevError);
  });

  it("accepts bare numeric answers", () => {
    const answers = parseAnswers(
      { a: 0.5, s: 2 },
      { a: { type: "noul" }, s: { type: "score", min: 0, max: 3 } },
    );
    expect(answers).toEqual({ a: 0.5, s: 2 });
  });

  it("treats a stalled response as a timeout, which fails open upstream", async () => {
    const never: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abort = new Error("The operation was aborted");
          abort.name = "AbortError";
          reject(abort);
        });
      });
    const jev = new JevClient({ apiKey: "k", timeoutMs: 20, fetchImpl: never });
    await expect(jev.ask(STATE, QUESTIONS)).rejects.toThrowError(/timed out/);
  }, 10_000);
});
