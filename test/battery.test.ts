import { describe, expect, it } from "vitest";
import { buildQuestions, buildState } from "../src/guardrails/battery.ts";

describe("buildQuestions", () => {
  it("includes the four hazards as nouls and severity as a score", () => {
    const questions = buildQuestions();
    expect(Object.keys(questions).sort()).toEqual(
      [
        "destructive_command",
        "prompt_injection",
        "credentials_access",
        "secret_exfiltration",
        "severity",
      ].sort(),
    );
    const hazards: Array<keyof typeof questions & string> = [
      "destructive_command",
      "secret_exfiltration",
      "prompt_injection",
      "credentials_access",
    ];
    for (const hazard of hazards) {
      expect(questions[hazard]).toEqual({ type: "noul" });
    }
    expect(questions.severity).toEqual({ type: "score", min: 0, max: 3 });
  });
});

describe("buildState", () => {
  it("carries tool, text, cwd and last user prompt", () => {
    expect(buildState("bash", "ls", "/tmp", "fix tests")).toEqual({
      tool: "bash",
      text: "ls",
      cwd: "/tmp",
      lastUserPrompt: "fix tests",
    });
  });

  it("omits empty last user prompts", () => {
    expect(buildState("user", "hi", undefined, "   ")).toEqual({ tool: "user", text: "hi" });
  });
});
