import { isRecord } from "../common/guards.ts";
import type {
  ChoiceQuestion,
  JevQuestion,
  JevQuestions,
  NoulQuestion,
  ScoreQuestion,
} from "../types/jev.ts";

export type QuestionParse = { ok: true; questions: JevQuestions } | { ok: false; reason: string };

const MAX_SCORE_LEVELS = 10;
const ALLOWED_KEYS = new Set(["type", "instructions", "criteria"]);

export function normalizeQuestions(raw: unknown): QuestionParse {
  if (!isRecord(raw)) {
    return { ok: false, reason: '"questions" must be an object mapping a name to a question' };
  }
  const questions: JevQuestions = {};
  for (const [name, value] of Object.entries(raw)) {
    const parsed = normalizeQuestion(value);
    if (!parsed.ok) return { ok: false, reason: `Question "${name}": ${parsed.reason}` };
    questions[name] = parsed.value;
  }
  if (Object.keys(questions).length === 0) {
    return { ok: false, reason: '"questions" must contain at least one question' };
  }
  return { ok: true, questions };
}

function normalizeQuestion(
  raw: unknown,
): { ok: true; value: JevQuestion } | { ok: false; reason: string } {
  if (!isRecord(raw)) return { ok: false, reason: "must be an object" };
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      return {
        ok: false,
        reason: `unknown field "${key}" (allowed: type, instructions, criteria)`,
      };
    }
  }
  const type = raw.type;
  const instructions = raw.instructions;
  const criteria = raw.criteria;
  if (typeof instructions !== "string" || instructions.trim() === "") {
    return { ok: false, reason: 'needs a non-empty "instructions" string' };
  }
  if (type === "noul") return normalizeNoul(instructions, criteria);
  if (type === "choice") return normalizeChoice(instructions, criteria);
  if (type === "score") return normalizeScore(instructions, criteria);
  return { ok: false, reason: `"type" must be "noul", "choice" or "score"` };
}

function normalizeNoul(
  instructions: string,
  criteria: unknown,
): { ok: true; value: NoulQuestion } | { ok: false; reason: string } {
  if (criteria === undefined) return { ok: true, value: { type: "noul", instructions } };
  if (!isRecord(criteria))
    return { ok: false, reason: '"criteria" must be an object with "true" and "false"' };
  const yes = criteria.true;
  const no = criteria.false;
  if (typeof yes !== "string" || yes.trim() === "" || typeof no !== "string" || no.trim() === "") {
    return {
      ok: false,
      reason: '"criteria" must have both a non-empty "true" and a non-empty "false" description',
    };
  }
  return { ok: true, value: { type: "noul", instructions, criteria: { true: yes, false: no } } };
}

function normalizeChoice(
  instructions: string,
  criteria: unknown,
): { ok: true; value: ChoiceQuestion } | { ok: false; reason: string } {
  if (!isRecord(criteria))
    return { ok: false, reason: '"criteria" must be an object of option -> description' };
  const options = Object.entries(criteria);
  if (options.length < 2) {
    return { ok: false, reason: '"criteria" needs at least two options' };
  }
  if (options.some(([, value]) => typeof value !== "string" || (value as string).trim() === "")) {
    return { ok: false, reason: "every option needs a non-empty description" };
  }
  return {
    ok: true,
    value: { type: "choice", instructions, criteria: criteria as Record<string, string> },
  };
}

function normalizeScore(
  instructions: string,
  criteria: unknown,
): { ok: true; value: ScoreQuestion } | { ok: false; reason: string } {
  if (!Array.isArray(criteria) || criteria.length < 2) {
    return { ok: false, reason: '"criteria" must be an array of 2-10 labels, low to high' };
  }
  if (criteria.length > MAX_SCORE_LEVELS) {
    return { ok: false, reason: `"criteria" allows at most ${MAX_SCORE_LEVELS} levels` };
  }
  if (criteria.some((label) => typeof label !== "string" || (label as string).trim() === "")) {
    return { ok: false, reason: "every level needs a non-empty label" };
  }
  return {
    ok: true,
    value: {
      type: "score",
      min: 0,
      max: criteria.length - 1,
      instructions,
      criteria: criteria as string[],
    },
  };
}
