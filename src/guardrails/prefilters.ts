import type { HazardName } from "../types/screening.ts";

export interface PrefilterHit {
  hazard: HazardName;
  probability: number;
}

interface Pattern {
  hazard: HazardName;
  test: (command: string) => boolean;
}

export function matchPrefilter(command: string): PrefilterHit | undefined {
  for (const pattern of PATTERNS) {
    if (pattern.test(command)) return { hazard: pattern.hazard, probability: 1 };
  }
  return undefined;
}

function rmForceful(command: string): boolean {
  const match = command.match(/(?:^|[;&|]\s*|\n\s*|\b(?:sudo|doas)\s+)rm\b/);
  if (!match || match.index === undefined) return false;
  const rest = command.slice(match.index + match[0].length);
  let sawRecursive = false;
  let sawForce = false;
  for (const token of rest.split(/\s+/)) {
    if (token === "") continue;
    if (token !== "-" && !token.startsWith("-")) break;
    if (token === "--") break;
    if (token === "--no-preserve-root") return true;
    if (token.startsWith("--")) {
      if (token === "--recursive") sawRecursive = true;
      continue;
    }
    for (const flag of token.slice(1)) {
      if (flag === "r" || flag === "R") sawRecursive = true;
      else if (flag === "f") sawForce = true;
    }
  }
  return sawRecursive && sawForce;
}

function shellPiped(requester: string) {
  return (command: string): boolean => {
    const re = new RegExp(`\\b${requester}\\b[^\\n|;]*\\|\\s*(?:sudo\\s+)?(?:ba|z|da|fi|k)?sh\\b`);
    return re.test(command);
  };
}

const PATTERNS: readonly Pattern[] = [
  { hazard: "destructive_command", test: rmForceful },
  { hazard: "destructive_command", test: shellPiped("curl") },
  { hazard: "destructive_command", test: shellPiped("wget") },
  {
    hazard: "credentials_access",
    test: (command) =>
      /\b(?:cat|less|more|head|tail|cp|mv|tee|grep|cut)\b[^\n]*(?:\.ssh[/\\]|id_rsa|id_ed25519|id_ecdsa|\.aws[/\\]credentials|\.netrc|\.git-credentials|\.npmrc)/.test(
        command,
      ),
  },
];
