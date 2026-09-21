export type NoulQuestion = {
  type: "noul";
  instructions?: string;
  criteria?: { true: string; false: string };
};

export type ScoreQuestion = {
  type: "score";
  min: number;
  max: number;
  instructions?: string;
  criteria?: string[];
};

export type ChoiceQuestion = {
  type: "choice";
  instructions?: string;
  criteria?: Record<string, string>;
};

export type JevQuestion = NoulQuestion | ScoreQuestion | ChoiceQuestion;

export type JevQuestions = Record<string, JevQuestion>;

export interface NoulAnswer {
  probability: number;
}

export interface ScoreAnswer {
  value: number;
}

export interface ChoiceAnswer {
  option: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export type JevAnswerOf<Q> = Q extends NoulQuestion
  ? NoulAnswer
  : Q extends ScoreQuestion
    ? ScoreAnswer
    : Q extends ChoiceQuestion
      ? ChoiceAnswer
      : never;

export type JevAnswers<Q> = { [K in keyof Q]: JevAnswerOf<Q[K]> };

export type JevAnswerPayload = number | NoulAnswer | ScoreAnswer | ChoiceAnswer;

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
