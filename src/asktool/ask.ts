import { type ToolDefinition, tool } from "@opencode-ai/plugin";
import { askJev } from "../ask/engine.ts";
import type { GuardrailsLogger } from "../logger.ts";
import type { JevAsker, JevQuestions, JevState } from "../types/jev.ts";
import { normalizeQuestions } from "./questions.ts";
import { loadSpecQuestions } from "./spec.ts";

export interface AskToolDependencies {
  client: JevAsker;
  logger: GuardrailsLogger;
}

export const ASK_TOOL_NAME = "jev_ask";

const DESCRIPTION = `Ask TypeSafe's Jev decision model for a typed judgment with calibrated probabilities over a piece of state.
Returns bare answers — a yes/no probability (noul), one choice among named options (choice), or an ordinal score (score) — never generated text, explanations or summaries.
Use to classify, triage, route, screen or rank an input such as an email, log line, comment, diff or request, and as a cheap pre-filter before expensive reading.
Not for writing, summarizing, extracting or math. Put all questions about the same input into one call (one batched request); describe observable conditions, not goals.`;

export function createAskTool(deps: AskToolDependencies): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      state: tool.schema
        .string()
        .describe(
          "The content to judge (text or JSON string). Keep it trimmed to what the questions need — well under 32K tokens.",
        ),
      spec: tool.schema
        .string()
        .optional()
        .describe(
          'Name of a saved spec resolved from ~/.config/jev/specs/<name>.json, or a path to a spec JSON file. Use for predefined batteries; then omit "questions".',
        ),
      questions: tool.schema
        .record(tool.schema.string(), tool.schema.any())
        .optional()
        .describe(
          'Inline questions, name -> definition. noul: {type:"noul", instructions:string, criteria?:{true:string,false:string}}. choice: {type:"choice", instructions, criteria:{name:description,...2+}}. score: {type:"score", instructions, criteria:[2-10 labels low to high]}',
        ),
    },
    async execute(args, context) {
      const outcome = await ask(deps, args, {
        directory: context.directory,
        signal: context.abort,
      });
      return outcome.output;
    },
  });
}

export interface AskInput {
  state: string;
  spec?: string | undefined;
  questions?: unknown;
}

export interface AskContext {
  directory?: string;
  signal?: AbortSignal;
}

export interface AskOutcomeOutput {
  ok: boolean;
  output: string;
}

export async function ask(
  deps: AskToolDependencies,
  input: AskInput,
  context: AskContext = {},
): Promise<AskOutcomeOutput> {
  const validation = await resolveQuestions(input.spec, input.questions);
  if (!validation.ok) {
    return failVisible(validation.reason);
  }
  const questions = validation.questions;
  if (typeof input.state !== "string" || input.state.trim() === "") {
    return failVisible('"state" must be a non-empty string');
  }

  const state: JevState = { tool: ASK_TOOL_NAME, text: input.state };
  if (context.directory !== undefined) state.cwd = context.directory;

  const result = await askJev(deps.client, state, questions as JevQuestions);
  const questionNames = Object.keys(questions).join(",");
  await deps.logger.record({
    ts: new Date().toISOString(),
    tool: ASK_TOOL_NAME,
    kind: "tool",
    question: questionNames,
    decision: result.ok ? "answered" : "error",
    policy: "none",
    elapsedMs: result.elapsedMs,
    cached: false,
    ...(result.ok ? {} : { error: result.reason }),
  });

  if (!result.ok) {
    return failVisible(`Jev could not evaluate: ${result.reason}`);
  }
  return {
    ok: true,
    output: formatAnswers(questions as JevQuestions, result.answers),
  };
}

function failVisible(reason: string): AskOutcomeOutput {
  return { ok: false, output: `jev_ask could not run: ${reason}` };
}

async function resolveQuestions(
  spec: string | undefined,
  questions: unknown,
): Promise<{ ok: true; questions: JevQuestions } | { ok: false; reason: string }> {
  const hasSpec = typeof spec === "string" && spec.trim() !== "";
  if (hasSpec) {
    if (questions !== undefined) {
      return { ok: false, reason: 'provide either "spec" or "questions", not both' };
    }
    return loadSpecQuestions(spec);
  }
  if (questions === undefined) {
    return { ok: false, reason: 'provide "questions" (inline) or a "spec" name' };
  }
  return normalizeQuestions(questions);
}

function formatAnswers(questions: JevQuestions, answers: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [name, question] of Object.entries(questions)) {
    const answer = answers[name] as unknown;
    if (question.type === "noul") {
      const { probability } = answer as { probability: number };
      lines.push(`${name}: ${probability >= 0.5 ? "yes" : "no"} (p=${fixed2(probability)})`);
    } else if (question.type === "score") {
      const { value } = answer as { value: number };
      lines.push(`${name}: ${value}`);
    } else {
      const { option, confidence } = answer as { option: string; confidence: number };
      lines.push(`${name}: ${option} (confidence=${fixed2(confidence)})`);
    }
  }
  return lines.join("\n");
}

function fixed2(value: number): string {
  return value.toFixed(2);
}
