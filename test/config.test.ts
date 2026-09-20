import { describe, expect, it } from "vitest";
import { resolveOptions } from "../src/config.ts";

describe("resolveOptions", () => {
  it("fails without an apiKey", () => {
    const result = resolveOptions({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/apiKey/);
  });

  it("fails on an empty apiKey", () => {
    const result = resolveOptions({ apiKey: "   " });
    expect(result.ok).toBe(false);
  });

  it("resolves defaults from a minimal valid config", () => {
    const result = resolveOptions({ apiKey: "apikey_x" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.model).toBe("jev-latest");
      expect(result.config.policy).toBe("strict");
      expect(result.config.timeoutMs).toBe(2000);
      expect(result.config.modules).toEqual({
        guardrails: true,
        routing: false,
        compaction: false,
      });
      expect(result.config.policies.strict).toEqual({
        action: 0.7,
        review: 0.35,
        severityBlock: 2.0,
      });
    }
  });

  it("reports unknown option keys once as warnings", () => {
    const result = resolveOptions({ apiKey: "k", foo: 1, bar: "x" });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      'Unknown plugin option "foo" ignored',
      'Unknown plugin option "bar" ignored',
    ]);
  });

  it("accepts the strict policy and permissive policy names", () => {
    expect(resolveOptions({ apiKey: "k", policy: "permissive" }).ok).toBe(true);
    const result = resolveOptions({ apiKey: "k", policy: "adventurous" as unknown as string });
    expect(result.ok).toBe(false);
  });

  it("merges partial policy overrides onto the defaults", () => {
    const result = resolveOptions({
      apiKey: "k",
      policies: { strict: { action: 0.9 } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.policies.strict).toEqual({
        action: 0.9,
        review: 0.35,
        severityBlock: 2.0,
      });
      expect(result.config.policies.permissive).toEqual({
        action: 0.85,
        review: 0.35,
        severityBlock: 2.0,
      });
    }
  });

  it("fails on an unknown policy name", () => {
    const result = resolveOptions({ apiKey: "k", policies: { aggressive: { action: 0.5 } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/aggressive/);
  });

  it("fails on non-numeric thresholds", () => {
    const result = resolveOptions({ apiKey: "k", policies: { strict: { action: "high" } } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.policies.strict.action).toBe(0.7);
    }
  });

  it("fails on a non-positive timeoutMs", () => {
    expect(resolveOptions({ apiKey: "k", timeoutMs: 0 }).ok).toBe(false);
    expect(resolveOptions({ apiKey: "k", timeoutMs: -5 }).ok).toBe(false);
    expect(resolveOptions({ apiKey: "k", timeoutMs: "fast" }).ok).toBe(false);
    expect(resolveOptions({ apiKey: "k", timeoutMs: 3000 }).ok).toBe(true);
  });

  it("validates module toggles", () => {
    const ok = resolveOptions({
      apiKey: "k",
      modules: { guardrails: true, routing: false, compaction: true },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.config.modules.compaction).toBe(true);
    expect(resolveOptions({ apiKey: "k", modules: { turbo: true } }).ok).toBe(false);
    expect(resolveOptions({ apiKey: "k", modules: { guardrails: "yes" } }).ok).toBe(false);
  });

  it("rejects non-object options", () => {
    expect(() => resolveOptions("nope")).toThrowError(/object/i);
    expect(() => resolveOptions(null)).not.toThrowError();
  });
});
