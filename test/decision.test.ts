import { describe, expect, it } from "vitest";
import { decide } from "../src/guardrails/decision.ts";
import type { Policy } from "../src/types/config.ts";
import type { Screening } from "../src/types/screening.ts";

const STRICT: Policy = { action: 0.7, review: 0.35, severityBlock: 2.0 };
const PERMISSIVE: Policy = { action: 0.85, review: 0.35, severityBlock: 2.0 };

function screening(highest: number, severity = 0): Screening {
  return {
    probabilities: {
      destructive_command: highest,
      secret_exfiltration: 0,
      prompt_injection: 0,
      credentials_access: 0,
    },
    severity,
  };
}

describe("decide", () => {
  it("passes below review threshold", () => {
    expect(decide(screening(0.1), STRICT)).toEqual({ decision: "pass" });
  });

  it("annotates at review threshold when below action", () => {
    const result = decide(screening(0.35), STRICT);
    expect(result.decision).toBe("review");
    expect(result.hazard).toBe("destructive_command");
    expect(result.probability).toBe(0.35);
  });

  it("escalates at action threshold", () => {
    const result = decide(screening(0.7), STRICT);
    expect(result.decision).toBe("ask");
    expect(result.hazard).toBe("destructive_command");
  });

  it("escalates beyond action threshold with the composed hazard", () => {
    const result = decide(screening(0.95), STRICT);
    expect(result.decision).toBe("ask");
    expect(result.hazard).toBe("destructive_command");
  });

  it("escalates on severity alone above severityBlock", () => {
    const result = decide(screening(0.0, 2.0), STRICT);
    expect(result.decision).toBe("ask");
    expect(result.hazard).toBe("severity");
    expect(result.severity).toBe(2.0);
  });

  it("stays at review when severity alone is below severityBlock", () => {
    const result = decide(screening(0.0, 1.9), STRICT);
    expect(result.decision).toBe("pass");
  });

  it("prefers the command hazard over severity when both would escalate", () => {
    const result = decide(screening(0.9, 2.5), STRICT);
    expect(result.decision).toBe("ask");
    expect(result.hazard).toBe("destructive_command");
  });

  it("respects the permissive policy's higher action threshold", () => {
    const result = decide(screening(0.8), PERMISSIVE);
    expect(result.decision).toBe("review");
  });

  it("escalates only past the permissive action threshold", () => {
    expect(decide(screening(0.85), PERMISSIVE).decision).toBe("ask");
    expect(decide(screening(0.84), PERMISSIVE).decision).toBe("review");
  });
});
