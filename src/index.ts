import { ASK_TOOL_NAME, createAskTool } from "./asktool/ask.ts";
import { resolveOptions } from "./config.ts";
import { screen } from "./guardrails/screen.ts";
import { JevClient } from "./jev.ts";
import { createLogger } from "./logger.ts";
import type { ScreenTool } from "./types/screening.ts";

export interface PluginContext {
  options?: unknown;
}

interface ToolExecuteBeforeInput {
  tool: string;
  session_id?: string;
  callID?: string;
}

interface ToolExecuteBeforeOutput {
  args?: { command?: unknown };
  permission?: { status: "ask" };
}

interface ChatTextPart {
  type: string;
  text?: unknown;
}

interface ChatMessageInput {
  message?: {
    role?: unknown;
    parts?: unknown[];
  };
}

export interface JevPluginHooks {
  config?: (input: unknown) => Promise<void>;
  tool?: { [key: string]: unknown };
  "tool.execute.before"?: (
    input: ToolExecuteBeforeInput,
    output: ToolExecuteBeforeOutput,
  ) => Promise<void>;
  "chat.message"?: (input: ChatMessageInput) => Promise<void>;
}

export const JevGuardrailsPlugin = async (context: PluginContext = {}): Promise<JevPluginHooks> => {
  const logger = createLogger();
  const resolved = resolveOptions(context.options);

  if (!resolved.ok) {
    for (const warning of resolved.warnings) await logger.warn(warning);
    await logger.warn(`Jev guardrails plugin disabled: ${resolved.reason}`);
    return {};
  }

  const { config, warnings } = resolved;
  for (const warning of warnings) await logger.warn(warning);

  let lastUserPrompt: string | undefined;

  const deps = {
    client: new JevClient({
      apiKey: config.apiKey,
      model: config.model,
      timeoutMs: config.timeoutMs,
    }),
    logger,
    policyName: config.policy,
    policies: config.policies,
  };

  const screenItem = (tool: ScreenTool, text: string, cwd?: string) =>
    screen(deps, { tool, text, cwd, lastUserPrompt });

  const hooks: JevPluginHooks = {};

  if (config.modules.tool) {
    hooks.config = async () => {
      return;
    };
    hooks.tool = {
      [ASK_TOOL_NAME]: createAskTool({ client: deps.client, logger }),
    };
  }

  if (config.modules.guardrails) {
    if (hooks.config === undefined) {
      hooks.config = async () => {
        return;
      };
    }
    hooks["tool.execute.before"] = async (input, output) => {
      if (input?.tool !== "bash") return;
      const command = output?.args?.command;
      if (typeof command !== "string" || command.trim() === "") return;
      const result = await screenItem("bash", command, process.cwd());
      if (result.decision === "ask" && output !== undefined) {
        output.permission = { status: "ask" };
      }
    };
    hooks["chat.message"] = async (input) => {
      const text = extractMessageText(input?.message);
      if (text === undefined) return;
      const result = await screenItem("user", text);
      if (result.decision === "ask") {
        await deps.logger.warn(
          `Jev guardrails: user message flagged (${result.hazard ?? "unknown"}) — chat.message cannot deny a turn`,
        );
      }
      lastUserPrompt = text;
    };
  }

  return hooks;
};

export default JevGuardrailsPlugin;

function extractMessageText(message: ChatMessageInput["message"]): string | undefined {
  if (message === undefined || message === null) return undefined;
  const text = extractMessagePartsText(message.parts);
  return text === "" ? undefined : text;
}

function extractMessagePartsText(parts: unknown[] | undefined): string {
  if (parts === undefined || parts === null || parts.length === 0) return "";
  const segments: string[] = [];
  for (const part of parts) {
    if (isChatTextPart(part)) segments.push(part.text);
  }
  return segments.join("\n").trim();
}

function isChatTextPart(part: unknown): part is ChatTextPart & { text: string } {
  if (part === null || typeof part !== "object") return false;
  const candidate = part as Partial<ChatTextPart>;
  return candidate.type === "text" && typeof candidate.text === "string";
}
