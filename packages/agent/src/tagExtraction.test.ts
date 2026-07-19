import { parseNote } from "@knowledge-agent/core";
import { describe, expect, it } from "vitest";
import { buildTagExtractionRequest, localExtractedTags, parseExtractedTags } from "./tagExtraction";

const note = parseNote({
  path: "数学/题目.md",
  content: "---\ntags: [导数]\n---\n# 闭区间函数最值\n\n使用导数判断单调性，并比较驻点和区间端点。"
});

describe("tag extraction", () => {
  it("builds a focused structured classification request", () => {
    const request = buildTagExtractionRequest(note, 3, "deepseek-v4-pro");
    expect(request.model).toBe("deepseek-v4-pro");
    expect(request.system).toContain("Return JSON only");
    expect(request.messages[0].content).toContain("闭区间函数最值");
  });

  it("parses JSON tags while preserving existing user tags", () => {
    const tags = parseExtractedTags('{"tags":[{"name":"函数最值"},{"name":"区间端点"}]}', note, 3);
    expect(tags[0]).toBe("导数");
    expect(tags).toContain("函数最值");
    expect(tags).toContain("区间端点");
  });

  it("falls back to local extraction when a model response is malformed", () => {
    expect(parseExtractedTags("not json", note, 3)).toEqual(localExtractedTags(note, 3));
  });
});
