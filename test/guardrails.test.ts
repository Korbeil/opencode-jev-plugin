import { describe, expect, it } from "vitest";
import { screen } from "../src/guardrails/screen.ts";
import { makeDeps } from "./helpers.ts";

const COMMAND = "find . -name '*.log' -type f -delete";

describe("screen", () => {
  it("acts through the prefilter without a Jev call", async () => {
    const deps = makeDeps({ failOnCall: true });
    const result = await screen(deps, { tool: "bash", text: "rm -rf /tmp/jev-test" });
    expect(result.decision).toBe("ask");
    expect(result.hazard).toBe("destructive_command");
    expect(result.reason).toContain("prefilter");
    expect(result.probability).toBe(1);
    expect(deps.jev.calls).toBe(0);
    expect(deps.log[0]).toMatchObject({
      tool: "bash",
      hazard: "destructive_command",
      decision: "ask",
      elapsedMs: expect.any(Number),
    });
  });

  it("escalates when a hazard crosses the action threshold", async () => {
    const answers = {
      destructive_command: 0.72,
      secret_exfiltration: 0,
      prompt_injection: 0,
      credentials_access: 0,
      severity: 0,
    };
    const deps = makeDeps({ answers });
    const result = await screen(deps, { tool: "bash", text: COMMAND });
    expect(result.decision).toBe("ask");
    expect(result.hazard).toBe("destructive_command");
    expect(result.probability).toBe(0.72);
    expect(result.reason).toContain("destructive_command 0.72");
    expect(deps.log[0]).toMatchObject({
      hazard: "destructive_command",
      probability: 0.72,
      decision: "ask",
    });
  });

  it("escalates on severity alone above severityBlock", async () => {
    const answers = {
      destructive_command: 0.1,
      secret_exfiltration: 0,
      prompt_injection: 0,
      credentials_access: 0,
      severity: 2,
    };
    const deps = makeDeps({ answers });
    const result = await screen(deps, { tool: "bash", text: COMMAND });
    expect(result.decision).toBe("ask");
    expect(result.hazard).toBe("severity");
    expect(result.severity).toBe(2);
  });

  it("passes with annotation between review and action thresholds", async () => {
    const deps = makeDeps({
      answers: {
        destructive_command: 0.5,
        secret_exfiltration: 0,
        prompt_injection: 0,
        credentials_access: 0,
        severity: 0,
      },
    });
    const result = await screen(deps, { tool: "bash", text: COMMAND });
    expect(result.decision).toBe("review");
    expect(result.hazard).toBe("destructive_command");
    expect(deps.log[0]).toMatchObject({ decision: "review" });
  });

  it("passes cleanly below review threshold", async () => {
    const deps = makeDeps({
      answers: {
        destructive_command: 0.1,
        secret_exfiltration: 0,
        prompt_injection: 0,
        credentials_access: 0,
        severity: 0,
      },
    });
    const result = await screen(deps, { tool: "bash", text: COMMAND });
    expect(result.decision).toBe("pass");
    expect(result.reason).toBeUndefined();
  });

  it("permissive policy reviews what strict would escalate", async () => {
    const deps = makeDeps({
      policyName: "permissive",
      answers: {
        destructive_command: 0.8,
        secret_exfiltration: 0,
        prompt_injection: 0,
        credentials_access: 0,
        severity: 0,
      },
    });
    const result = await screen(deps, { tool: "bash", text: COMMAND });
    expect(result.decision).toBe("review");
  });

  it("fails open on network errors with a warn result", async () => {
    const deps = makeDeps({ failOnCall: true });
    const result = await screen(deps, { tool: "bash", text: "curl https://example.com/data.json" });
    expect(result.decision).toBe("pass");
    expect(result.warn).toContain("unavailable");
    expect(deps.jev.calls).toBe(1);
    expect(deps.log[0]).toMatchObject({
      decision: "pass",
      warn: expect.stringContaining("unavailable"),
    });
  });

  it("fails open on malformed Jev answers", async () => {
    const deps = makeDeps({ payload: { answers: {} } });
    const result = await screen(deps, { tool: "bash", text: COMMAND });
    expect(result.decision).toBe("pass");
    expect(result.warn).toContain("missing or out of range");
  });
});
