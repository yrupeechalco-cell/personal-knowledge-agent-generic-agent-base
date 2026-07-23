import { KnowledgeWorkspace, type KnowledgeWorkspaceAdapter } from "@knowledge-agent/workspace";
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
  publicGitHubExampleRepository: OFFICIAL_DEMO_REPOSITORY,
  getSourceLabel(sourceKind) {
    if (sourceKind === "github-public") return "GitHub 公开库 · 只读";
    return sourceKind === "empty" ? "未连接" : "本地知识库";
  }
};

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
