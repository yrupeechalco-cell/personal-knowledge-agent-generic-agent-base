/** Installed local application; no note access or arbitrary plugin code execution. */
export const TYPEWORDS_PLUGIN = {
  id: "typewords",
  name: "英语学习",
  version: "0.1.0",
  application: "TypeWords 3.0.7",
  entryUrl: "http://127.0.0.1:5567/words",
  storageKey: "knowledge-agent.plugins.typewords.enabled.v1"
} as const;

export interface TypeWordsAdapter {
  ensureStarted(): Promise<void>;
  selectDirectory(): Promise<boolean>;
}

export function isTypeWordsEnabled(): boolean {
  try { return localStorage.getItem(TYPEWORDS_PLUGIN.storageKey) !== "false"; } catch { return true; }
}

export async function checkTypeWords(signal: AbortSignal): Promise<void> {
  // Cross-origin opaque responses are expected; the launcher separately verifies identity.
  await fetch(TYPEWORDS_PLUGIN.entryUrl, { mode: "no-cors", cache: "no-store", credentials: "omit", signal });
}
