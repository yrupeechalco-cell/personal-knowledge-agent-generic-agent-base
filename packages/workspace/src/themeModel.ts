export type AppTheme = "light" | "dark";

export const APP_THEME_STORAGE_KEY = "knowledge-agent.theme";
export const DEFAULT_APP_THEME: AppTheme = "light";

export function normalizeAppTheme(value: unknown): AppTheme {
  return value === "dark" || value === "light" ? value : DEFAULT_APP_THEME;
}

export function oppositeAppTheme(theme: AppTheme): AppTheme {
  return theme === "light" ? "dark" : "light";
}
