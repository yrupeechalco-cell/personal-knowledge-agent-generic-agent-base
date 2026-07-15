import {
  buildSafetyManifest,
  isMarkdownFile,
  normalizePath,
  safetyDecisionForPath,
  type NoteFile,
  type SafetyManifest
} from "@knowledge-agent/core";
import type { LoadedVault } from "@knowledge-agent/workspace";

const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";
const MAX_MARKDOWN_FILES = 500;
const MAX_NOTE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const RAW_FETCH_CONCURRENCY = 8;
const STATIC_MANIFEST_FILE = ".knowledge-agent-vault.json";

export const OFFICIAL_DEMO_REPOSITORY = "yrupeechalco-cell/knowledge-agent-public-demo-vault";

export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
}

interface GitHubRepositoryResponse {
  default_branch?: string;
  full_name?: string;
  private?: boolean;
}

interface GitHubTreeItem {
  path?: string;
  size?: number;
  type?: string;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeItem[];
  truncated?: boolean;
}

interface PublicVaultManifest {
  version?: number;
  branch?: string;
  files?: Array<{ path?: string; size?: number }>;
}

interface GitHubVaultListing {
  branch: string;
  fullName: string;
  markdownItems: Array<{ path: string; size: number }>;
}

export function parseGitHubRepository(value: string): GitHubRepositoryRef {
  const input = value.trim();
  if (!input) throw new Error("请输入 GitHub 公开仓库地址或 owner/repo。");

  let path = input;
  if (/^https?:\/\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new Error("GitHub 仓库地址格式不正确。");
    }
    if (url.hostname.toLowerCase() !== "github.com" && url.hostname.toLowerCase() !== "www.github.com") {
      throw new Error("当前只支持 github.com 的公开仓库。");
    }
    path = url.pathname;
  }

  const segments = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new Error("请填写仓库首页地址，例如 https://github.com/owner/repo。");
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  const validSegment = /^[A-Za-z0-9_.-]+$/;
  if (!owner || !repo || !validSegment.test(owner) || !validSegment.test(repo)) {
    throw new Error("GitHub 仓库名称包含不支持的字符。");
  }
  return { owner, repo };
}

export function githubRepositorySlug(value: string): string {
  const { owner, repo } = parseGitHubRepository(value);
  return `${owner}/${repo}`;
}

export async function loadPublicGitHubVault(
  repository: string,
  fetchImpl: typeof fetch = fetch
): Promise<LoadedVault> {
  const { owner, repo } = parseGitHubRepository(repository);
  const listing =
    (await tryLoadStaticManifest(owner, repo, fetchImpl)) ??
    (await loadGitHubApiListing(owner, repo, fetchImpl));
  const { branch, fullName, markdownItems } = listing;
  const safetyManifest = buildGitHubSafetyManifest(markdownItems);
  const allowedPaths = new Set(safetyManifest.allowed.map((decision) => decision.path));
  const allowedItems = markdownItems.filter((item) => allowedPaths.has(item.path));

  if (allowedItems.length > MAX_MARKDOWN_FILES) {
    throw new Error(`公开仓库包含 ${allowedItems.length} 篇安全 Markdown，超过网页端 ${MAX_MARKDOWN_FILES} 篇读取上限。`);
  }
  const totalBytes = allowedItems.reduce((total, item) => total + item.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(`公开仓库 Markdown 总量约 ${formatMiB(totalBytes)} MiB，超过网页端 ${formatMiB(MAX_TOTAL_BYTES)} MiB 读取上限。`);
  }

  let fetchedTotalBytes = 0;
  const files = await mapWithConcurrency(allowedItems, RAW_FETCH_CONCURRENCY, async (item) => {
    const rawUrl = `${GITHUB_RAW}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${encodePath(item.path)}`;
    const response = await fetchImpl(rawUrl);
    if (!response.ok) throw new Error(`读取 ${item.path} 失败（HTTP ${response.status}）。`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_NOTE_BYTES) {
      throw new Error(`${item.path} 超过网页端 ${formatMiB(MAX_NOTE_BYTES)} MiB 单篇读取上限。`);
    }
    const content = await response.text();
    const contentBytes = new TextEncoder().encode(content).byteLength;
    if (contentBytes > MAX_NOTE_BYTES) {
      throw new Error(`${item.path} 超过网页端 ${formatMiB(MAX_NOTE_BYTES)} MiB 单篇读取上限。`);
    }
    fetchedTotalBytes += contentBytes;
    if (fetchedTotalBytes > MAX_TOTAL_BYTES) {
      throw new Error(`公开仓库实际 Markdown 总量超过网页端 ${formatMiB(MAX_TOTAL_BYTES)} MiB 读取上限。`);
    }
    return {
      path: item.path,
      content
    } satisfies NoteFile;
  });

  return {
    files,
    sourceName: `github.com/${fullName} · ${branch}`,
    sourceKind: "github-public",
    safetyManifest
  };
}

async function tryLoadStaticManifest(
  owner: string,
  repo: string,
  fetchImpl: typeof fetch
): Promise<GitHubVaultListing | null> {
  const url = `${GITHUB_RAW}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/HEAD/${STATIC_MANIFEST_FILE}`;
  const response = await fetchImpl(url, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`读取公开知识库清单失败（HTTP ${response.status}）。`);

  let manifest: PublicVaultManifest;
  try {
    manifest = (await response.json()) as PublicVaultManifest;
  } catch {
    throw new Error(`公开知识库的 ${STATIC_MANIFEST_FILE} 不是有效 JSON。`);
  }
  if (manifest.version !== 1 || typeof manifest.branch !== "string" || !manifest.branch.trim() || !Array.isArray(manifest.files)) {
    throw new Error(`公开知识库的 ${STATIC_MANIFEST_FILE} 格式不受支持。`);
  }

  const seen = new Set<string>();
  const markdownItems = manifest.files.map((item) => {
    if (typeof item.path !== "string" || !isMarkdownFile(item.path) || !Number.isFinite(item.size) || item.size! < 0) {
      throw new Error(`公开知识库的 ${STATIC_MANIFEST_FILE} 包含无效文件记录。`);
    }
    const path = normalizePath(item.path);
    if (!path || /^[A-Za-z]:/.test(path) || path.startsWith("/") || path.split("/").some((part) => part === "." || part === "..")) {
      throw new Error(`公开知识库清单包含不安全路径：${item.path}。`);
    }
    if (seen.has(path)) throw new Error(`公开知识库清单包含重复路径：${path}。`);
    seen.add(path);
    return { path, size: item.size! };
  }).sort((left, right) => left.path.localeCompare(right.path));

  return {
    branch: manifest.branch.trim(),
    fullName: `${owner}/${repo}`,
    markdownItems
  };
}

async function loadGitHubApiListing(
  owner: string,
  repo: string,
  fetchImpl: typeof fetch
): Promise<GitHubVaultListing> {
  const repositoryResponse = await githubJson<GitHubRepositoryResponse>(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    fetchImpl
  );
  if (repositoryResponse.private) {
    throw new Error("这个仓库不是公开仓库；Web 只读入口不会请求私人仓库权限。");
  }

  const branch = repositoryResponse.default_branch;
  if (!branch) throw new Error("GitHub 没有返回仓库默认分支。");
  const treeResponse = await githubJson<GitHubTreeResponse>(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    fetchImpl
  );
  if (treeResponse.truncated) {
    throw new Error("仓库文件树超过 GitHub 递归接口上限，当前版本不会读取不完整的知识库。");
  }

  return {
    branch,
    fullName: repositoryResponse.full_name || `${owner}/${repo}`,
    markdownItems: (treeResponse.tree ?? [])
      .filter((item) => item.type === "blob" && typeof item.path === "string" && isMarkdownFile(item.path))
      .map((item) => ({ path: normalizePath(item.path!), size: item.size ?? 0 }))
      .sort((left, right) => left.path.localeCompare(right.path))
  };
}

function buildGitHubSafetyManifest(items: Array<{ path: string; size: number }>): SafetyManifest {
  const pathManifest = buildSafetyManifest(items.map((item) => item.path));
  const oversized = items
    .filter((item) => item.size > MAX_NOTE_BYTES && safetyDecisionForPath(item.path).allowed)
    .map((item) => ({
      path: item.path,
      allowed: false,
      reason: `file exceeds ${formatMiB(MAX_NOTE_BYTES)} MiB browser limit`
    }));
  if (oversized.length === 0) return pathManifest;
  const oversizedPaths = new Set(oversized.map((decision) => decision.path));
  return {
    allowed: pathManifest.allowed.filter((decision) => !oversizedPaths.has(decision.path)),
    excluded: [...pathManifest.excluded, ...oversized]
  };
}

async function githubJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (response.ok) return response.json() as Promise<T>;

  if (response.status === 404) {
    throw new Error("没有找到这个公开仓库。请检查地址；私有仓库在未登录时也会返回 404。");
  }
  if (response.status === 403 || response.status === 429) {
    const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
    const resetHint = Number.isFinite(resetSeconds)
      ? `，可在 ${new Date(resetSeconds * 1000).toLocaleTimeString()} 后重试`
      : "";
    throw new Error(`GitHub 匿名 API 请求已被限流${resetHint}。`);
  }
  throw new Error(`GitHub 请求失败（HTTP ${response.status}）。`);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function formatMiB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);
}
