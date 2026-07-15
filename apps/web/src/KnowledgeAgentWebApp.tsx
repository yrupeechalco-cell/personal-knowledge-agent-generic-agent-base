import { KnowledgeWorkspace, type KnowledgeWorkspaceAdapter } from "@knowledge-agent/workspace";
import { isDirectoryPickerSupported, loadBrowserDirectoryVault, loadEmptyVault } from "./vaultSources";

const webWorkspaceAdapter: KnowledgeWorkspaceAdapter = {
  canOpenVault: isDirectoryPickerSupported(),
  loadInitialVault: loadEmptyVault,
  openVault: loadBrowserDirectoryVault,
  getSourceLabel(sourceKind) {
    return sourceKind === "empty" ? "未连接" : "本地知识库";
  }
};

export function KnowledgeAgentWebApp() {
  return <KnowledgeWorkspace adapter={webWorkspaceAdapter} />;
}
