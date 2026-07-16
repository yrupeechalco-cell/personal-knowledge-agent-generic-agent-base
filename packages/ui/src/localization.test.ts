import { describe, expect, it } from "vitest";
import { detectPreferredLocale, translateRuntimeText, translateText } from "./localization";

describe("localization", () => {
  it("prefers an explicit URL language over stored and browser preferences", () => {
    expect(detectPreferredLocale({
      search: "?lang=en",
      storedLocale: "zh-CN",
      browserLanguages: ["zh-CN"]
    })).toBe("en");

    expect(detectPreferredLocale({
      search: "?lang=zh",
      storedLocale: "en",
      browserLanguages: ["en-US"]
    })).toBe("zh-CN");
  });

  it("uses English for non-Chinese browsers and keeps Chinese for Chinese browsers", () => {
    expect(detectPreferredLocale({ search: "", storedLocale: null, browserLanguages: ["en-US"] })).toBe("en");
    expect(detectPreferredLocale({ search: "", storedLocale: null, browserLanguages: ["zh-CN", "en-US"] })).toBe("zh-CN");
  });

  it("translates static interface labels and dynamic graph summaries", () => {
    expect(translateText("连接你的知识库", "en")).toBe("Connect your knowledge base");
    expect(translateText("连接你的知识库", "zh-CN")).toBe("连接你的知识库");
    expect(translateRuntimeText("12 个领域 · 36 条跨域依据", "en")).toBe("12 domains · 36 cross-domain evidence links");
    expect(translateRuntimeText("已框选 4 篇文档", "en")).toBe("4 documents selected");
  });
});
