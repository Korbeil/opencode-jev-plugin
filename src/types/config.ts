export interface Policy {
  action: number;
  review: number;
  severityBlock: number;
}

export type PolicyName = "strict" | "permissive";

export interface ModuleToggles {
  guardrails: boolean;
  routing: boolean;
  compaction: boolean;
}

export interface PluginConfig {
  apiKey: string;
  model: string;
  policy: PolicyName;
  policies: Record<PolicyName, Policy>;
  modules: ModuleToggles;
  timeoutMs: number;
}

export interface RawPluginOptions {
  apiKey?: unknown;
  model?: unknown;
  policy?: unknown;
  policies?: unknown;
  modules?: unknown;
  timeoutMs?: unknown;
}

export interface RawPolicyOverride {
  action?: unknown;
  review?: unknown;
  severityBlock?: unknown;
}

export type ResolveOk = { ok: true; config: PluginConfig; warnings: string[] };
export type ResolveFail = { ok: false; reason: string; warnings: string[] };
