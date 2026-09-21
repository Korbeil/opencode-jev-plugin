import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isRecord } from "../common/guards.ts";
import type { JevQuestions } from "../types/jev.ts";
import { normalizeQuestions } from "./questions.ts";

export type SpecLoad = { ok: true; questions: JevQuestions } | { ok: false; reason: string };

export async function loadSpecQuestions(name: string): Promise<SpecLoad> {
  if (typeof name !== "string" || name.trim() === "") {
    return { ok: false, reason: "spec name must be a non-empty string" };
  }
  const looksLikePath = name.includes("/") || name.endsWith(".json");
  const candidates = looksLikePath ? [name] : [path.join(configDir(), "specs", `${name}.json`)];
  for (const candidate of candidates) {
    const target = expandPath(candidate);
    let text: string;
    try {
      text = await readFile(target, "utf8");
    } catch {
      continue;
    }
    return parseSpecFile(text, target);
  }
  return {
    ok: false,
    reason: `spec not found: looked for ${candidates.map((c) => expandPath(c)).join(", ")}`,
  };
}

function parseSpecFile(text: string, source: string): SpecLoad {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, reason: `spec is not valid JSON: ${source}` };
  }
  if (!isRecord(payload)) return { ok: false, reason: `spec must be a JSON object: ${source}` };
  return normalizeQuestions(payload.questions);
}

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? path.join(xdg, "jev") : path.join(homedir(), ".config", "jev");
}

function expandPath(value: string): string {
  if (value === "~" || value.startsWith("~/")) {
    return path.join(homedir(), value.slice(1));
  }
  return value;
}
