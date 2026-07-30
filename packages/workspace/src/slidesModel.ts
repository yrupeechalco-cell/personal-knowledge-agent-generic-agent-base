export interface MarkdownSlide {
  id: string;
  title: string;
  lines: string[];
}

export function splitMarkdownSlides(content: string): MarkdownSlide[] {
  const body = stripFrontmatter(content);
  const sections: string[][] = [[]];
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && /^\s*---\s*$/.test(line)) {
      sections.push([]);
      continue;
    }
    sections[sections.length - 1].push(line);
  }
  return sections
    .map((lines) => trimBlankLines(lines))
    .filter((lines) => lines.some((line) => line.trim()))
    .map((lines, index) => ({
      id: `slide-${index + 1}`,
      title: slideTitle(lines, index),
      lines
    }));
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, "");
}

function trimBlankLines(lines: string[]): string[] {
  const next = [...lines];
  while (next[0]?.trim() === "") next.shift();
  while (next[next.length - 1]?.trim() === "") next.pop();
  return next;
}

function slideTitle(lines: string[], index: number): string {
  const heading = lines.find((line) => /^ {0,3}#{1,6}\s+/.test(line));
  return heading?.replace(/^ {0,3}#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim() || `Slide ${index + 1}`;
}
