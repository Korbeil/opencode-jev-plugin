export type NoulQuestion = { type: "noul" };

export type ScoreQuestion = { type: "score"; min: number; max: number };

export type JevQuestion = NoulQuestion | ScoreQuestion;

export type JevQuestions = Record<string, JevQuestion>;

export interface JevProbabilityAnswer {
  probability: number;
}

export interface JevLevelAnswer {
  value: number;
}

export type JevAnswerPayload = number | JevProbabilityAnswer | JevLevelAnswer;

export type JevAnswers<Q> = { [K in keyof Q]: number };

export interface JevState {
  tool: string;
  text: string;
  cwd?: string;
  lastUserPrompt?: string;
}

export interface JevAsker {
  ask<Q extends Partial<JevQuestions>>(
    state: JevState,
    questions: Q,
  ): Promise<JevAnswers<Required<Q>>>;
}
