import type { AgentDiff, AgentPermission } from "./types";

export function classifyEdit(before: string, after: string, path: string): Pick<AgentDiff, "permission" | "reason"> {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const changedLineCount = Math.abs(afterLines.length - beforeLines.length) + lineDifferenceCount(beforeLines, afterLines);
  const deletesLargeChunk = after.length < before.length * 0.65;
  const touchesSensitivePath = /密码|账号|secret|password|credential|token/i.test(path);

  if (touchesSensitivePath) {
    return { permission: "blocked", reason: "sensitive path cannot be modified by Agent" };
  }
  if (deletesLargeChunk || changedLineCount > 20) {
    return { permission: "confirm", reason: "large or destructive edit requires confirmation" };
  }
  return { permission: "auto", reason: "small single-note edit" };
}

export function classifyRestore(originalPath: string, purgeAfterMs: number, nowMs = Date.now()): Pick<AgentDiff, "permission" | "reason"> {
  const touchesSensitivePath = /密码|账号|账户|secret|password|credential|token|apikey|api-key/i.test(originalPath);
  if (touchesSensitivePath) {
    return { permission: "blocked", reason: "sensitive paths cannot be restored by Agent" };
  }
  if (!Number.isFinite(purgeAfterMs) || purgeAfterMs <= nowMs) {
    return { permission: "blocked", reason: "trash entry is expired or missing a valid purge deadline" };
  }
  return { permission: "confirm", reason: "restore changes the local vault and requires Agent recovery authorization" };
}

export function permissionRank(permission: AgentPermission): number {
  if (permission === "blocked") return 2;
  if (permission === "confirm") return 1;
  return 0;
}

function lineDifferenceCount(left: string[], right: string[]): number {
  const max = Math.max(left.length, right.length);
  let count = 0;
  for (let index = 0; index < max; index += 1) {
    if ((left[index] ?? "") !== (right[index] ?? "")) count += 1;
  }
  return count;
}
