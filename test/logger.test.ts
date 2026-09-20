import { appendFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.ts";

const RUN_ID = `${Date.now()}-${process.pid}`;

function logFile(name: string): string {
  return path.join(tmpdir(), `jev-logger-test-${RUN_ID}-${name}.log`);
}

describe("createLogger", () => {
  it("appends one JSON line per record", async () => {
    const target = logFile("record");
    const logger = createLogger(target);
    await logger.record({
      ts: "2026-09-18T12:00:00.000Z",
      tool: "bash",
      hazard: "destructive_command",
      probability: 0.72,
      severity: 1,
      decision: "ask",
      policy: "strict",
      elapsedMs: 12,
      cached: false,
    });
    await logger.record({
      ts: "2026-09-18T12:00:01.000Z",
      tool: "bash",
      decision: "pass",
      policy: "strict",
      elapsedMs: 5,
      cached: false,
    });
    const content = await readFile(target, "utf8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual(
      expect.objectContaining({
        ts: "2026-09-18T12:00:00.000Z",
        tool: "bash",
        hazard: "destructive_command",
        probability: 0.72,
        decision: "ask",
        policy: "strict",
        elapsedMs: 12,
        cached: false,
      }),
    );
  });

  it("writes a warn entry with the warn field", async () => {
    const target = logFile("warn");
    const logger = createLogger(target);
    await logger.warn("something went sideways");
    const content = await readFile(target, "utf8");
    const entry = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(entry.decision).toBe("warn");
    expect(entry.warn).toBe("something went sideways");
  });

  it("never throws when the target is unwritable", async () => {
    const file = logFile("not-a-dir");
    await appendFile(file, "x");
    const logger = createLogger(path.join(file, "nested", "jev.log"));
    await expect(logger.warn("nope")).resolves.toBeUndefined();
  });

  it("creates parent directories on the way", async () => {
    const target = path.join(tmpdir(), `jev-logger-${RUN_ID}`, "nested", "jev.log");
    const logger = createLogger(target);
    await logger.warn("nested");
    const content = await readFile(target, "utf8");
    expect(content).toContain("nested");
  });
});
