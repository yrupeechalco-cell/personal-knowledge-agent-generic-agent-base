import { describe, expect, it, vi } from "vitest";
import { githubRepositorySlug, loadPublicGitHubVault, parseGitHubRepository } from "./githubVaultSource";

describe("GitHub public vault source", () => {
  it("parses repository slugs and GitHub homepage URLs", () => {
    expect(parseGitHubRepository("owner/repo")).toEqual({ owner: "owner", repo: "repo" });
    expect(parseGitHubRepository("https://github.com/owner/repo.git/")).toEqual({ owner: "owner", repo: "repo" });
    expect(githubRepositorySlug("https://github.com/owner/repo")).toBe("owner/repo");
  });

  it("rejects non-GitHub and non-repository URLs", () => {
    expect(() => parseGitHubRepository("https://example.com/owner/repo")).toThrow("只支持 github.com");
    expect(() => parseGitHubRepository("https://github.com/owner/repo/tree/main")).toThrow("仓库首页地址");
  });

  it("loads safe Markdown and excludes sensitive paths", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/HEAD/.knowledge-agent-vault.json")) return new Response("not found", { status: 404 });
      if (url === "https://api.github.com/repos/owner/repo") {
        return jsonResponse({ default_branch: "main", full_name: "owner/repo", private: false });
      }
      if (url.includes("/git/trees/main?recursive=1")) {
        return jsonResponse({
          truncated: false,
          tree: [
            { path: "00-索引.md", size: 30, type: "blob" },
            { path: "知识/图论.md", size: 40, type: "blob" },
            { path: "Secrets/token.md", size: 10, type: "blob" },
            { path: "assets/graph.png", size: 100, type: "blob" }
          ]
        });
      }
      if (url.endsWith("/00-%E7%B4%A2%E5%BC%95.md")) return new Response("# 索引\n\n[[知识/图论]]");
      if (url.endsWith("/%E7%9F%A5%E8%AF%86/%E5%9B%BE%E8%AE%BA.md")) return new Response("# 图论");
      return new Response("not found", { status: 404 });
    });

    const vault = await loadPublicGitHubVault("owner/repo", fetchMock);

    expect(vault.sourceKind).toBe("github-public");
    expect(vault.sourceName).toBe("github.com/owner/repo · main");
    expect(vault.files.map((file) => file.path)).toEqual(["00-索引.md", "知识/图论.md"]);
    expect(vault.safetyManifest.excluded.map((item) => item.path)).toContain("Secrets/token.md");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("uses a repository manifest without spending anonymous GitHub API requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/HEAD/.knowledge-agent-vault.json")) {
        return jsonResponse({
          version: 1,
          branch: "main",
          files: [
            { path: "开始.md", size: 20 },
            { path: "密码/账号.md", size: 20 }
          ]
        });
      }
      if (url.endsWith("/%E5%BC%80%E5%A7%8B.md")) return new Response("# 开始");
      return new Response("not found", { status: 404 });
    });

    const vault = await loadPublicGitHubVault("owner/repo", fetchMock);

    expect(vault.files).toEqual([{ path: "开始.md", content: "# 开始" }]);
    expect(vault.safetyManifest.excluded.map((item) => item.path)).toContain("密码/账号.md");
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("https://api.github.com"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects traversal paths declared by a repository manifest", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        version: 1,
        branch: "main",
        files: [{ path: "../outside.md", size: 20 }]
      })
    );

    await expect(loadPublicGitHubVault("owner/repo", fetchMock)).rejects.toThrow("不安全路径");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports private or missing repositories without requesting content", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 404 }));

    await expect(loadPublicGitHubVault("owner/private", fetchMock)).rejects.toThrow("没有找到这个公开仓库");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports anonymous API rate limits", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).includes("raw.githubusercontent.com")
        ? new Response("{}", { status: 404 })
        : new Response("{}", {
        status: 403,
        headers: { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60) }
      })
    );

    await expect(loadPublicGitHubVault("owner/repo", fetchMock)).rejects.toThrow("GitHub 匿名 API 请求已被限流");
  });

  it("refuses a truncated repository tree instead of showing an incomplete graph", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("raw.githubusercontent.com")) return new Response("not found", { status: 404 });
      return url.endsWith("/repos/owner/repo")
        ? jsonResponse({ default_branch: "main", full_name: "owner/repo", private: false })
        : jsonResponse({ truncated: true, tree: [] });
    });

    await expect(loadPublicGitHubVault("owner/repo", fetchMock)).rejects.toThrow("不会读取不完整的知识库");
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" }
  });
}
