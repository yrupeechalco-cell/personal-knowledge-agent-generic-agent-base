import type { SafetyDecision, SafetyManifest } from "./types";
import { normalizePath } from "./path";

const BLOCKED_SEGMENTS = new Set([
  ".obsidian",
  ".git",
  ".claude",
  ".venv",
  "node_modules",
  "target",
  "dist",
  "build",
  "private-vaults",
  "vaults"
]);

const SENSITIVE_WORDS = [
  "\u5bc6\u7801",
  "\u8d26\u53f7",
  "\u8d26\u6237",
  "secret",
  "secrets",
  "password",
  "credential",
  "credentials",
  "private",
  "token",
  "apikey",
  "api-key"
];

export function safetyDecisionForPath(path: string): SafetyDecision {
  const normalized = normalizePath(path);
  const lower = normalized.toLowerCase();
  const segments = lower.split("/");
  const base = segments.at(-1) ?? lower;

  if (base === ".env" || base.startsWith(".env.")) {
    return { path: normalized, allowed: false, reason: "environment secret file" };
  }

  for (const segment of segments) {
    if (BLOCKED_SEGMENTS.has(segment)) {
      return { path: normalized, allowed: false, reason: `blocked directory: ${segment}` };
    }
    if (segment.startsWith(".") && segment !== ".kb") {
      return { path: normalized, allowed: false, reason: `hidden directory or file: ${segment}` };
    }
  }

  for (const word of SENSITIVE_WORDS) {
    if (lower.includes(word.toLowerCase())) {
      return { path: normalized, allowed: false, reason: `sensitive keyword: ${word}` };
    }
  }

  return { path: normalized, allowed: true, reason: "allowed by default rules" };
}

export function buildSafetyManifest(paths: string[]): SafetyManifest {
  const decisions = paths.map(safetyDecisionForPath);
  return {
    allowed: decisions.filter((decision) => decision.allowed),
    excluded: decisions.filter((decision) => !decision.allowed)
  };
}
