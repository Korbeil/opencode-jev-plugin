import type { JevState, NoulQuestion, ScoreQuestion } from "../types/jev.ts";
import { SEVERITY_MAX, SEVERITY_MIN, SEVERITY_NAME } from "../types/screening.ts";

export interface HazardProbabilities {
  destructive_command: number;
  secret_exfiltration: number;
  prompt_injection: number;
  credentials_access: number;
  severity: number;
}

export type ScreeningQuestions = {
  destructive_command: NoulQuestion;
  secret_exfiltration: NoulQuestion;
  prompt_injection: NoulQuestion;
  credentials_access: NoulQuestion;
  severity: ScoreQuestion;
};

export function buildQuestions(): ScreeningQuestions {
  return {
    destructive_command: { type: "noul" },
    secret_exfiltration: { type: "noul" },
    prompt_injection: { type: "noul" },
    credentials_access: { type: "noul" },
    [SEVERITY_NAME]: { type: "score", min: SEVERITY_MIN, max: SEVERITY_MAX },
  };
}

export function buildState(
  tool: string,
  text: string,
  cwd?: string,
  lastUserPrompt?: string,
): JevState {
  const state: JevState = { tool, text };
  if (cwd !== undefined) state.cwd = cwd;
  if (lastUserPrompt !== undefined && lastUserPrompt.trim() !== "")
    state.lastUserPrompt = lastUserPrompt;
  return state;
}
