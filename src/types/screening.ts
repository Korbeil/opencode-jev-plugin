export const HAZARDS = [
  "destructive_command",
  "secret_exfiltration",
  "prompt_injection",
  "credentials_access",
] as const;

export type HazardName = (typeof HAZARDS)[number];

export const SEVERITY_NAME = "severity";
export const SEVERITY_MIN = 0;
export const SEVERITY_MAX = 3;

export type ScreenTool = "bash" | "user";

export type Decision = "ask" | "review" | "pass";

export interface Screening {
  probabilities: Partial<Record<HazardName, number>>;
  severity?: number;
}

export interface DecisionResult {
  decision: Decision;
  hazard?: string;
  probability?: number;
  severity?: number;
}
