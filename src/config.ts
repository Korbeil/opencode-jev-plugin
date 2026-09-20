import { finiteNumber, isRecord } from "./common/guards.ts";
import type {
  ModuleToggles,
  PluginConfig,
  Policy,
  PolicyName,
  RawPluginOptions,
  RawPolicyOverride,
  ResolveFail,
  ResolveOk,
} from "./types/config.ts";

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "apiKey",
  "model",
  "policy",
  "policies",
  "modules",
  "timeoutMs",
]);

const OPTION_KEYS = ["apiKey", "model", "policy", "policies", "modules", "timeoutMs"] as const;

export const DEFAULT_POLICIES: Record<PolicyName, Policy> = {
  strict: { action: 0.7, review: 0.35, severityBlock: 2.0 },
  permissive: { action: 0.85, review: 0.35, severityBlock: 2.0 },
};

const DEFAULT_MODEL = "jev-latest";
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MODULES: ModuleToggles = { guardrails: true, routing: false, compaction: false };

export function resolveOptions(input: unknown): ResolveOk | ResolveFail {
  const warnings: string[] = [];
  const raw = asRawOptions(input);

  if (raw === undefined) {
    return { ok: false, reason: 'Option "apiKey" is required (a Jev API key)', warnings };
  }
  reportUnknownKeys(raw, warnings);

  let fatal: string | undefined;
  let apiKey: string | undefined;
  let model: string | undefined;
  let policy: PolicyName | undefined;
  let policies: Partial<Record<PolicyName, RawPolicyOverride>> | undefined;
  let modules: Partial<ModuleToggles> | undefined;
  let timeoutMs: number | undefined;

  for (const key of OPTION_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    switch (key) {
      case "apiKey": {
        if (typeof value !== "string" || value.trim() === "")
          fatal = 'Option "apiKey" must be a non-empty string';
        else apiKey = value;
        break;
      }
      case "model": {
        if (typeof value !== "string" || value.trim() === "")
          fatal = 'Option "model" must be a non-empty string';
        else model = value;
        break;
      }
      case "policy": {
        if (value !== "strict" && value !== "permissive")
          fatal = 'Option "policy" must be "strict" or "permissive"';
        else policy = value;
        break;
      }
      case "policies": {
        const parsed = parsePolicyOverrides(value);
        if (!parsed.ok) fatal = parsed.reason;
        else policies = parsed.value;
        break;
      }
      case "modules": {
        const parsed = parseModules(value);
        if (!parsed.ok) fatal = parsed.reason;
        else modules = parsed.value;
        break;
      }
      case "timeoutMs": {
        const timeout = finiteNumber(value);
        if (timeout === undefined || timeout <= 0)
          fatal = 'Option "timeoutMs" must be a positive number';
        else timeoutMs = timeout;
        break;
      }
    }
  }

  if (fatal !== undefined) return { ok: false, reason: fatal, warnings };
  if (apiKey === undefined || apiKey.trim() === "") {
    return { ok: false, reason: 'Option "apiKey" is required (a Jev API key)', warnings };
  }

  const config: PluginConfig = {
    apiKey,
    model: model ?? DEFAULT_MODEL,
    policy: policy ?? "strict",
    policies: {
      strict: mergePolicy(DEFAULT_POLICIES.strict, policies?.strict),
      permissive: mergePolicy(DEFAULT_POLICIES.permissive, policies?.permissive),
    },
    modules: { ...DEFAULT_MODULES, ...modules },
    timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  return { ok: true, config, warnings };
}

function asRawOptions(input: unknown): RawPluginOptions | undefined {
  if (input === undefined || input === null) return undefined;
  if (!isRecord(input)) throw new Error("Plugin options must be an object");
  return input as RawPluginOptions;
}

function reportUnknownKeys(raw: RawPluginOptions, warnings: string[]): void {
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (!KNOWN_KEYS.has(key)) warnings.push(`Unknown plugin option "${key}" ignored`);
  }
}

export function mergePolicy(base: Policy, override: RawPolicyOverride | undefined): Policy {
  return {
    action: normalizeThreshold(override?.action, base.action),
    review: normalizeThreshold(override?.review, base.review),
    severityBlock: normalizeSeverityBlock(override?.severityBlock, base.severityBlock),
  };
}

function normalizeThreshold(raw: unknown, fallback: number): number {
  const value = finiteNumber(raw);
  if (value === undefined || value < 0) return fallback;
  return Math.min(value, 1);
}

function normalizeSeverityBlock(raw: unknown, fallback: number): number {
  const value = finiteNumber(raw);
  if (value === undefined || value < 0) return fallback;
  return value;
}

function parsePolicyOverrides(
  raw: unknown,
):
  | { ok: true; value: Partial<Record<PolicyName, RawPolicyOverride>> }
  | { ok: false; reason: string } {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isRecord(raw)) return { ok: false, reason: 'Option "policies" must be an object' };
  const overrides: Partial<Record<PolicyName, RawPolicyOverride>> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (name !== "strict" && name !== "permissive") {
      return {
        ok: false,
        reason: `Unknown policy name "${name}" (expected "strict" or "permissive")`,
      };
    }
    if (value !== undefined && value !== null && !isRecord(value)) {
      return { ok: false, reason: `Policy "${name}" must be an object with numeric thresholds` };
    }
    overrides[name] = value as RawPolicyOverride;
  }
  return { ok: true, value: overrides };
}

function parseModules(
  raw: unknown,
): { ok: true; value: Partial<ModuleToggles> } | { ok: false; reason: string } {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isRecord(raw)) return { ok: false, reason: 'Option "modules" must be an object' };
  const toggles: Partial<ModuleToggles> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (name !== "guardrails" && name !== "routing" && name !== "compaction") {
      return {
        ok: false,
        reason: `Unknown module "${name}" (expected "guardrails", "routing", "compaction")`,
      };
    }
    if (typeof value !== "boolean") {
      return { ok: false, reason: `Module "${name}" must be a boolean` };
    }
    toggles[name] = value;
  }
  return { ok: true, value: toggles };
}
