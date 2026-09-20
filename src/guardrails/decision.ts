import { pickHighest } from "../common/format.ts";
import type { Policy } from "../types/config.ts";
import {
  type DecisionResult,
  HAZARDS,
  type HazardName,
  type Screening,
  SEVERITY_NAME,
} from "../types/screening.ts";

export function decide(screening: Screening, policy: Policy): DecisionResult {
  const highest = pickHighest(screening.probabilities, HAZARDS);
  const hazard = highest.name as HazardName | undefined;
  const probability = highest.value;

  if (hazard !== undefined && probability >= policy.action) {
    return { decision: "ask", hazard, probability };
  }
  if (screening.severity !== undefined && screening.severity >= policy.severityBlock) {
    return { decision: "ask", hazard: SEVERITY_NAME, severity: screening.severity };
  }
  if (hazard !== undefined && probability >= policy.review) {
    return { decision: "review", hazard, probability };
  }
  return { decision: "pass" };
}
