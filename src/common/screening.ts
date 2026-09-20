import type { JevAnswers, JevAsker, JevQuestions, JevState } from "../types/jev.ts";

interface ScreeningParams<Q extends Partial<JevQuestions>, T> {
  client: JevAsker;
  questions: Q;
  state: JevState;
  evaluate: (answers: JevAnswers<Required<Q>>, elapsedMs: number) => T;
  failOpen: (reason: string, elapsedMs: number) => T;
}

export async function screened<Q extends Partial<JevQuestions>, T>(
  params: ScreeningParams<Q, T>,
): Promise<T> {
  const startedAt = Date.now();
  const elapsed = () => Math.max(0, Date.now() - startedAt);
  try {
    const answers = await params.client.ask(params.state, params.questions);
    return await params.evaluate(answers, elapsed());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return params.failOpen(reason, elapsed());
  }
}
