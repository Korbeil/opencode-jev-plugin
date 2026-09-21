import { finiteNumber, isRecord, numberInRange } from "./common/guards.ts";
import type {
  ChoiceAnswer,
  JevAnswerPayload,
  JevAnswers,
  JevQuestion,
  JevQuestions,
  JevState,
  NoulAnswer,
  ScoreAnswer,
} from "./types/jev.ts";

export * from "./types/jev.ts";

export const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_MODEL = "jev-latest";
export const DEFAULT_TIMEOUT_MS = 2000;
export const DEFAULT_BACKOFF_MS = 150;

const MAX_ATTEMPTS = 2;
const RETRYABLE_STATUS = new Set([429, 529]);

export class JevError extends Error {
  readonly retryable?: boolean;

  constructor(message: string, options?: { retryable?: boolean }) {
    super(message);
    this.name = "JevError";
    this.retryable = options?.retryable;
  }
}

export interface JevClientOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  backoffMs?: number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JevClient {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #endpoint: string;
  readonly #fetchImpl: typeof fetch;
  readonly #backoffMs: number;

  constructor(options: JevClientOptions) {
    if (typeof options.apiKey !== "string" || options.apiKey.trim() === "") {
      throw new JevError("apiKey is required to build a Jev client");
    }
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.#fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.#backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    if (this.#timeoutMs <= 0) throw new JevError("timeoutMs must be a positive number");
  }

  async ask<Q extends Partial<JevQuestions>>(
    state: JevState,
    questions: Q,
  ): Promise<JevAnswers<Required<Q>>> {
    let retry: JevError | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(this.#backoffMs * attempt);
      const response = await this.#request(state, questions as JevQuestions);
      if (RETRYABLE_STATUS.has(response.status)) {
        retry = new JevError(`Jev unavailable (HTTP ${response.status})`, { retryable: true });
        continue;
      }
      if (!response.ok) throw new JevError(`Jev request failed (HTTP ${response.status})`);
      const payload = await response.json().catch(() => {
        throw new JevError("Jev returned malformed JSON");
      });
      return parseAnswers<JevQuestions>(payload, questions as JevQuestions) as JevAnswers<
        Required<Q>
      >;
    }
    throw retry ?? new JevError("Jev request failed");
  }

  async #request(state: JevState, questions: JevQuestions): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetchImpl(this.#endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify({ model: this.#model, state, questions }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new JevError(`Jev request timed out after ${this.#timeoutMs}ms`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new JevError(`Jev network error: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export function parseAnswers<Q extends JevQuestions>(
  payload: unknown,
  questions: Q,
): JevAnswers<Q> {
  const container = answerContainer(payload);
  const answers: Record<string, unknown> = {};
  for (const [name, question] of Object.entries<JevQuestion>(questions)) {
    const raw = container[name] as JevAnswerPayload | undefined;
    answers[name] =
      question.type === "noul"
        ? readProbability(raw, name)
        : question.type === "score"
          ? readScore(raw, name, question.min, question.max)
          : readChoice(raw, name);
  }
  return answers as JevAnswers<Q>;
}

function answerContainer(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) throw new JevError("Jev returned a malformed response");
  const answers = payload.answers;
  return isRecord(answers) ? answers : payload;
}

function answerValue(
  raw: JevAnswerPayload | undefined,
  key: "probability" | "value",
): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "number") return finiteNumber(raw);
  if (typeof raw !== "object") return undefined;
  if (key in raw) return finiteNumber((raw as unknown as Record<string, unknown>)[key]);
  return undefined;
}

function readProbability(raw: JevAnswerPayload | undefined, name: string): NoulAnswer {
  const value = answerValue(raw, "probability");
  if (value === undefined || !numberInRange(value, 0, 1)) {
    throw new JevError(`Jev noul "${name}" is missing or out of range`);
  }
  return { probability: value };
}

function readScore(
  raw: JevAnswerPayload | undefined,
  name: string,
  min: number,
  max: number,
): ScoreAnswer {
  const value = answerValue(raw, "value");
  if (value === undefined || !numberInRange(value, min, max)) {
    throw new JevError(`Jev score "${name}" is missing or out of range`);
  }
  return { value };
}

function readChoice(raw: JevAnswerPayload | undefined, name: string): ChoiceAnswer {
  if (raw !== undefined && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as unknown as Record<string, unknown>;
    const option = record.option ?? record.choice;
    const confidence = finiteNumber(record.confidence);
    const probabilities = record.probabilities;
    if (
      typeof option === "string" &&
      option !== "" &&
      confidence !== undefined &&
      numberInRange(confidence, 0, 1) &&
      isRecord(probabilities)
    ) {
      const distribution: Record<string, number> = {};
      for (const [key, value] of Object.entries(probabilities)) {
        const numeric = finiteNumber(value);
        if (numeric === undefined || !numberInRange(numeric, 0, 1)) {
          throw new JevError(`Jev choice "${name}" has an out-of-range probability for "${key}"`);
        }
        distribution[key] = numeric;
      }
      return { option, probabilities: distribution, confidence };
    }
  }
  throw new JevError(`Jev choice "${name}" is missing or malformed`);
}
