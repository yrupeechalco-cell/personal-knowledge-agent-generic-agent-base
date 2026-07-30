import {
  KnowledgeWorkspace,
  type AgentAttachmentSelection,
  type KnowledgeWorkspaceAdapter
} from "@knowledge-agent/workspace";
import { LanguageProvider } from "@knowledge-agent/ui";
import {
  githubRepositorySlug,
  loadPublicGitHubVault,
  OFFICIAL_DEMO_REPOSITORY
} from "./githubVaultSource";
import {
  clearBrowserDirectoryVault,
  isDirectoryPickerSupported,
  loadBrowserCanvasDocument,
  loadBrowserDirectoryVault,
  loadEmptyVault,
  saveBrowserCanvasDocument
} from "./vaultSources";

const webWorkspaceAdapter: KnowledgeWorkspaceAdapter = {
  canOpenVault: isDirectoryPickerSupported(),
  async loadInitialVault() {
    const repository = new URLSearchParams(window.location.search).get("repo");
    if (!repository) return loadEmptyVault();
    clearBrowserDirectoryVault();
    return loadPublicGitHubVault(repository);
  },
  async openVault() {
    const vault = await loadBrowserDirectoryVault();
    clearRepositoryQuery();
    return vault;
  },
  async openPublicGitHubRepo(repository) {
    clearBrowserDirectoryVault();
    const vault = await loadPublicGitHubVault(repository);
    setRepositoryQuery(githubRepositorySlug(repository));
    return vault;
  },
  loadCanvasDocument: loadBrowserCanvasDocument,
  saveCanvasDocument: saveBrowserCanvasDocument,
  selectAgentAttachments: selectBrowserAgentAttachments,
  publicGitHubExampleRepository: OFFICIAL_DEMO_REPOSITORY,
  getSourceLabel(sourceKind) {
    if (sourceKind === "github-public") return "GitHub 公开库 · 只读";
    return sourceKind === "empty" ? "未连接" : "本地知识库";
  }
};

async function selectBrowserAgentAttachments(): Promise<AgentAttachmentSelection> {
  const files = await chooseBrowserFiles();
  const attachments: AgentAttachmentSelection["attachments"] = [];
  const issues: string[] = [];
  for (const [index, file] of files.slice(0, 8).entries()) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!isBrowserTextAttachment(extension)) {
      issues.push(
        `${file.name}: 浏览器端当前只提取文本文件；Word 和图片 OCR 请使用 Windows 桌面 App`
      );
      continue;
    }
    if (file.size > 2 * 1_048_576) {
      issues.push(`${file.name}: 文件超过 2 MB，未读取`);
      continue;
    }
    const text = await file.text();
    if (!text.trim()) {
      issues.push(`${file.name}: 文件没有可发送给 Agent 的文字内容`);
      continue;
    }
    const content = [...text].slice(0, 12_000).join("");
    attachments.push({
      id: `browser-attachment-${Date.now()}-${index}`,
      name: file.name,
      kind: "text",
      content,
      size: file.size,
      mediaType: file.type || undefined,
      truncated: content.length < text.length
    });
  }
  if (files.length > 8) issues.push("一次最多读取 8 个附件，其余文件未加入");
  return { attachments, issues };
}

function chooseBrowserFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleFocus);
      resolve(Array.from(input.files ?? []));
    };
    const handleFocus = () => {
      window.setTimeout(finish, 250);
    };
    input.type = "file";
    input.multiple = true;
    input.accept = [
      ".md",
      ".txt",
      ".json",
      ".csv",
      ".tsv",
      ".html",
      ".xml",
      ".yaml",
      ".yml",
      ".toml",
      ".log",
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".py",
      ".rs",
      ".go",
      ".java",
      ".c",
      ".h",
      ".cpp",
      ".hpp",
      ".cs",
      ".sql",
      ".tex",
      ".rtf"
    ].join(",");
    input.addEventListener("change", finish, { once: true });
    window.addEventListener("focus", handleFocus, { once: true });
    input.click();
  });
}

function isBrowserTextAttachment(extension: string): boolean {
  return new Set([
    "md",
    "txt",
    "json",
    "csv",
    "tsv",
    "html",
    "xml",
    "yaml",
    "yml",
    "toml",
    "log",
    "js",
    "jsx",
    "ts",
    "tsx",
    "py",
    "rs",
    "go",
    "java",
    "c",
    "h",
    "cpp",
    "hpp",
    "cs",
    "sql",
    "tex",
    "rtf"
  ]).has(extension);
}

function setRepositoryQuery(repository: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("repo", repository);
  window.history.replaceState(null, "", url);
}

function clearRepositoryQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete("repo");
  window.history.replaceState(null, "", url);
}

export function KnowledgeAgentWebApp() {
  return (
    <LanguageProvider>
      <KnowledgeWorkspace adapter={webWorkspaceAdapter} />
    </LanguageProvider>
  );
}
