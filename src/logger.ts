import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface LogEntry {
  ts: string;
  tool: string;
  hazard?: string;
  probability?: number;
  severity?: number;
  decision: string;
  policy: string;
  elapsedMs: number;
  cached: boolean;
  warn?: string;
}

export interface GuardrailsLogger {
  record(entry: LogEntry): Promise<void>;
  warn(message: string): Promise<void>;
}

const DEFAULT_PATH = "~/.cache/opencode/jev-guardrails.log";

export function createLogger(logPath?: string): GuardrailsLogger {
  const target = expandPath(logPath ?? process.env.JEV_GUARDRAILS_LOG ?? DEFAULT_PATH);
  return {
    async record(entry: LogEntry): Promise<void> {
      try {
        await mkdir(path.dirname(target), { recursive: true });
        await appendFile(target, `${JSON.stringify(entry)}\n`);
      } catch {
        return;
      }
    },
    async warn(message: string): Promise<void> {
      await this.record({
        ts: new Date().toISOString(),
        tool: "plugin",
        decision: "warn",
        policy: "none",
        elapsedMs: 0,
        cached: false,
        warn: message,
      });
    },
  };
}

function expandPath(value: string): string {
  if (value === "~" || value.startsWith("~/")) {
    return path.join(homedir(), value.slice(1));
  }
  return value;
}
