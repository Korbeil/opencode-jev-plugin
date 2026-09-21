import type { JevAnswers, JevAsker, JevQuestions, JevState } from "../types/jev.ts";

export type AskCallKind = "guardrail" | "tool" | "routing" | "compaction";

export type AskOutcome<Q extends Partial<JevQuestions>> =
  | { ok: true; answers: JevAnswers<Required<Q>>; elapsedMs: number }
  | { ok: false; reason: string; elapsedMs: number };

export async function askJev<Q extends Partial<JevQuestions>>(
  client: JevAsker,
  state: JevState,
  questions: Q,
): Promise<AskOutcome<Q>> {
  const startedAt = Date.now();
  const elapsed = () => Math.max(0, Date.now() - startedAt);
  try {
    const answers = await client.ask(state, questions);
    return { ok: true, answers, elapsedMs: elapsed() };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, reason, elapsedMs: elapsed() };
  }
}
