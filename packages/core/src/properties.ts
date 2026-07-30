export type FrontmatterValue = string | string[] | boolean | number;

export function setNoteProperty(content: string, key: string, value: FrontmatterValue): string {
  const propertyKey = normalizePropertyKey(key);
  if (!propertyKey) return content;
  return updateFrontmatterLine(content, propertyKey, serializeFrontmatterValue(value));
}

export function removeNoteProperty(content: string, key: string): string {
  const propertyKey = normalizePropertyKey(key);
  if (!propertyKey) return content;
  return updateFrontmatterLine(content, propertyKey, null);
}

export function parseEditablePropertyValue(value: string, current?: FrontmatterValue): FrontmatterValue {
  const trimmed = value.trim();
  if (typeof current === "boolean") return /^(true|yes|on|1)$/i.test(trimmed);
  if (typeof current === "number" && trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  if (Array.isArray(current)) {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed) && Number.isFinite(Number(trimmed))) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Keep malformed array-like input as a string.
    }
  }
  return value;
}

function updateFrontmatterLine(content: string, key: string, serializedValue: string | null): string {
  const frontmatter = /^(---\r?\n)([\s\S]*?)(\r?\n---)(\r?\n)?/.exec(content);
  if (!frontmatter) {
    if (serializedValue === null) return content;
    return `---\n${key}: ${serializedValue}\n---\n${content.replace(/^\r?\n/, "")}`;
  }

  const newline = frontmatter[1].includes("\r\n") ? "\r\n" : "\n";
  const lines = frontmatter[2].split(/\r?\n/);
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:`, "i");
  const index = lines.findIndex((line) => pattern.test(line));
  if (index >= 0) {
    if (serializedValue === null) lines.splice(index, 1);
    else lines[index] = `${key}: ${serializedValue}`;
  } else if (serializedValue !== null) {
    lines.push(`${key}: ${serializedValue}`);
  }

  const body = content.slice(frontmatter[0].length);
  const frontmatterBody = lines.filter((line, lineIndex) => line !== "" || lineIndex > 0).join(newline);
  if (!frontmatterBody.trim()) return body.replace(/^\r?\n/, "");
  return `---${newline}${frontmatterBody}${newline}---${newline}${body.replace(/^\r?\n/, "")}`;
}

function serializeFrontmatterValue(value: FrontmatterValue): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function normalizePropertyKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed || /[\r\n:[\]{}#,]/.test(trimmed)) return "";
  return trimmed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
