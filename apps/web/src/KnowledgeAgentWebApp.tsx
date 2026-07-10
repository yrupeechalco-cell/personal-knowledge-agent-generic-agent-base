import { KnowledgeWorkspace, type KnowledgeWorkspaceAdapter } from "@knowledge-agent/workspace";
import { isDirectoryPickerSupported, loadBrowserDirectoryVault, loadDemoVault } from "./vaultSources";

const webWorkspaceAdapter: KnowledgeWorkspaceAdapter = {
  canOpenVault: isDirectoryPickerSupported(),
  loadInitialVault: loadDemoVault,
  openVault: loadBrowserDirectoryVault,
  loadDemoVault,
  getSourceLabel(sourceKind) {
    return sourceKind === "demo" ? "Demo" : "本地 vault";
  }
};

export function KnowledgeAgentWebApp() {
  return <KnowledgeWorkspace adapter={webWorkspaceAdapter} />;
}
