import { fixed2, shorten } from "../common/format.ts";
import { screened } from "../common/screening.ts";
import type { GuardrailsLogger, LogEntry } from "../logger.ts";
import type { Policy, PolicyName } from "../types/config.ts";
import type { JevAnswers, JevAsker } from "../types/jev.ts";
import {
  type Decision,
  type DecisionResult,
  HAZARDS,
  type HazardName,
  type Screening,
  SEVERITY_NAME,
} from "../types/screening.ts";
import { buildQuestions, buildState, type ScreeningQuestions } from "./battery.ts";
import { decide } from "./decision.ts";
import { matchPrefilter } from "./prefilters.ts";

export interface GuardrailsDependencies {
  client: JevAsker;
  logger: GuardrailsLogger;
  policyName: PolicyName;
  policies: Record<PolicyName, Policy>;
}

export interface ScreenResult {
  decision: Decision;
  hazard?: string;
  probability?: number;
  severity?: number;
  reason?: string;
  warn?: string;
}

export interface ScreeningItem {
  tool: string;
  text: string;
  cwd?: string;
  lastUserPrompt?: string;
}

interface AuditSeed {
  ts: string;
  tool: string;
  decision: Decision;
  policy: PolicyName;
  cached: boolean;
}

interface Evaluated {
  outcome: DecisionResult;
}

export async function screen(
  deps: GuardrailsDependencies,
  item: ScreeningItem,
): Promise<ScreenResult> {
  const policy = deps.policies[deps.policyName];
  const seed: AuditSeed = {
    ts: new Date().toISOString(),
    tool: item.tool,
    decision: "pass",
    policy: deps.policyName,
    cached: false,
  };

  const pre = matchPrefilter(item.text);
  if (pre !== undefined) {
    await deps.logger.record({
      ...seed,
      hazard: pre.hazard,
      probability: pre.probability,
      decision: "ask",
      elapsedMs: 0,
    });
    return {
      decision: "ask",
      hazard: pre.hazard,
      probability: pre.probability,
      reason: `Jev guardrails: ${pre.hazard} 1.00 (prefilter) — ${shorten(item.text)}`,
    };
  }

  const evaluated = await screened<ScreeningQuestions, Evaluated>({
    client: deps.client,
    questions: buildQuestions(),
    state: buildState(item.tool, item.text, item.cwd, item.lastUserPrompt),
    evaluate: (answers, elapsedMs) => {
      const outcome = decide(toScreening(answers), policy);
      void deps.logger.record(auditEntry(seed, outcome, elapsedMs));
      return { outcome };
    },
    failOpen: (reason, elapsedMs) => {
      void deps.logger.record({ ...seed, decision: "pass", elapsedMs, warn: reason });
      return { outcome: { decision: "pass", warn: reason } };
    },
  });
  if (evaluated.outcome.decision === "ask") {
    return { ...evaluated.outcome, reason: composeAskReason(evaluated.outcome, item.text) };
  }
  return evaluated.outcome;
}

function auditEntry(seed: AuditSeed, outcome: DecisionResult, elapsedMs: number): LogEntry {
  return {
    ...seed,
    hazard: outcome.hazard,
    probability: outcome.probability,
    severity: outcome.severity,
    decision: outcome.decision,
    elapsedMs,
  };
}

function toScreening(answers: JevAnswers<ScreeningQuestions>): Screening {
  const probabilities: Partial<Record<HazardName, number>> = {};
  for (const hazard of HAZARDS) {
    probabilities[hazard] = answers[hazard];
  }
  return { probabilities, severity: answers[SEVERITY_NAME] };
}

function composeAskReason(
  outcome: { hazard?: string; probability?: number; severity?: number },
  text: string,
): string {
  const subject =
    outcome.probability !== undefined
      ? `${outcome.hazard} ${fixed2(outcome.probability)}`
      : `severity ${fixed2(outcome.severity)}`;
  return `Jev guardrails: ${subject} — ${shorten(text)}`;
}
