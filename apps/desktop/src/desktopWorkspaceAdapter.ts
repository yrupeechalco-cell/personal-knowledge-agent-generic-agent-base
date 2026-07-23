import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ModelRequest, ModelTurnResponse } from "@knowledge-agent/agent";
import { buildSafetyManifest, type NoteFile } from "@knowledge-agent/core";
import type { KnowledgeCanvasDocument } from "@knowledge-agent/ui";
import {
  createEmptyVault,
  type DraftChange,
  type KnowledgeWorkspaceAdapter,
  type LoadedVault,
  type ModelConnectionSettings,
  type PathMove,
  type ReadOnlyDirectoryListing,
  type ReadOnlyFilePreview,
  type StorageRoot,
  type TrashEntry,
  type TrashEntryPreview,
  type WriteChangesResult
} from "@knowledge-agent/workspace";

interface AppSettings {
  vaultPath?: string;
  githubRepo?: string;
  modelProvider?: string;
  model?: string;
  agentMode?: string;
  deepSeekApiKeyConfigured?: boolean;
}

let activeVaultPath = "";

interface VaultChangedPayload {
  root: string;
  paths: string[];
}

export function createDesktopWorkspaceAdapter(): KnowledgeWorkspaceAdapter {
  return {
    canOpenVault: true,
    async loadInitialVault() {
      try {
        const settings = await invoke<AppSettings>("load_app_settings");
        if (settings.vaultPath) {
          return await loadVault(settings.vaultPath);
        }
        return createEmptyVault("请选择一个本地知识库文件夹；桌面端会记住上次路径。");
      } catch (error) {
        return createEmptyVault(`桌面设置暂不可用：${String(error)}`);
      }
    },
    async openVault() {
      const selected = await invoke<string | null>("select_vault_dir");
      if (!selected) {
        throw new Error("已取消打开文件夹，当前知识库保持不变。");
      }
      activeVaultPath = selected;
      await invoke("save_app_settings", { settings: { vaultPath: selected } satisfies AppSettings });
      return loadVault(selected);
    },
    async openReadOnlyStructure() {
      const selected = await invoke<string | null>("select_read_only_structure_dir");
      if (!selected) {
        throw new Error("已取消只读结构扫描，当前知识库保持不变。");
      }
      return loadReadOnlyRoot(selected);
    },
    async openReadOnlyRoot(root) {
      return loadReadOnlyRoot(root);
    },
    listStorageRoots() {
      return invoke<StorageRoot[]>("list_storage_roots");
    },
    listReadOnlyDirectory(root, path) {
      return invoke<ReadOnlyDirectoryListing>("list_directory_read_only", { root, path });
    },
    readReadOnlyFile(root, path) {
      return invoke<ReadOnlyFilePreview>("read_file_preview_read_only", { root, path });
    },
    async createVaultFolder(folderName) {
      const created = await invoke<string | null>("create_vault_dir", { name: folderName });
      if (!created) {
        throw new Error("已取消新建文件夹。");
      }
      activeVaultPath = created;
      await invoke("save_app_settings", { settings: { vaultPath: created } satisfies AppSettings });
      return loadVault(created);
    },
    async createInterlinkedVault(options) {
      const created = await invoke<string>("create_interlinked_demo_vault", {
        parent: options.parentPath,
        folderName: options.folderName,
        count: options.count
      });
      activeVaultPath = created;
      await invoke("save_app_settings", { settings: { vaultPath: created } satisfies AppSettings });
      return loadVault(created);
    },
    async createWordDocumentOnDesktop(request) {
      const path = await invoke<string>("create_word_document_on_desktop", { name: request.name });
      return { path };
    },
    async watchVault(onChange) {
      if (!activeVaultPath) return () => undefined;
      const watchedRoot = activeVaultPath;
      let reloadTimer: ReturnType<typeof setTimeout> | undefined;
      const unlisten = await listen<VaultChangedPayload>("vault-changed", (event) => {
        if (event.payload.root !== watchedRoot || activeVaultPath !== watchedRoot) return;
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          loadVault(watchedRoot)
            .then((vault) => onChange(vault, event.payload.paths))
            .catch(() => undefined);
        }, 220);
      });
      await invoke("start_vault_watcher", { root: watchedRoot });
      return () => {
        if (reloadTimer) clearTimeout(reloadTimer);
        unlisten();
        void invoke("stop_vault_watcher").catch(() => undefined);
      };
    },
    async writeChanges(changes) {
      if (!activeVaultPath) {
        throw new Error("还没有选择本地 vault，不能写回。");
      }
      return writeChangesToVaultWithTrash(activeVaultPath, changes);
    },
    async moveNotes(moves: PathMove[]) {
      if (!activeVaultPath) {
        throw new Error("还没有选择本地 vault，不能移动文档。");
      }
      await invoke("move_notes_atomic", { root: activeVaultPath, moves });
      const reloaded = await loadVault(activeVaultPath);
      const trashEntries = await invoke<TrashEntry[]>("list_trash_entries", { root: activeVaultPath });
      return {
        message: `已通过原子事务移动 ${moves.length} 篇文档。`,
        files: reloaded.files,
        safetyManifest: reloaded.safetyManifest,
        trashEntries
      };
    },
    async listTrashEntries() {
      if (!activeVaultPath) return [];
      return invoke<TrashEntry[]>("list_trash_entries", { root: activeVaultPath });
    },
    async previewTrashEntry(id) {
      if (!activeVaultPath) {
        throw new Error("还没有选择本地 vault，不能预览回收站文档。");
      }
      return invoke<TrashEntryPreview>("preview_trash_entry", { root: activeVaultPath, id });
    },
    async restoreTrashEntry(id) {
      if (!activeVaultPath) {
        throw new Error("还没有选择本地 vault，不能恢复回收站文档。");
      }
      await invoke("restore_trash_entry", { root: activeVaultPath, id });
      const reloaded = await loadVault(activeVaultPath);
      const trashEntries = await invoke<TrashEntry[]>("list_trash_entries", { root: activeVaultPath });
      return {
        message: "已从回收站恢复文档。",
        files: reloaded.files,
        safetyManifest: reloaded.safetyManifest,
        trashEntries
      };
    },
    async loadCanvasDocument() {
      if (!activeVaultPath) return null;
      return invoke<KnowledgeCanvasDocument | null>("load_canvas_document", { root: activeVaultPath });
    },
    async saveCanvasDocument(document) {
      if (!activeVaultPath) {
        throw new Error("请先打开一个本地知识库，再保存画布。");
      }
      await invoke("save_canvas_document", { root: activeVaultPath, document });
    },
    loadModelSettings() {
      return invoke<ModelConnectionSettings>("load_model_settings");
    },
    saveModelSettings(settings) {
      return invoke<ModelConnectionSettings>("save_model_settings", {
        provider: settings.provider,
        model: settings.model,
        agentMode: settings.agentMode
      });
    },
    saveDeepSeekApiKey(apiKey) {
      return invoke<ModelConnectionSettings>("save_deepseek_api_key", { apiKey });
    },
    deleteDeepSeekApiKey() {
      return invoke<ModelConnectionSettings>("delete_deepseek_api_key");
    },
    validateDeepSeekApiKey() {
      return invoke<ModelConnectionSettings>("validate_deepseek_api_key");
    },
    runModel(request: ModelRequest) {
      return invoke<string>("deepseek_chat_completion", { request });
    },
    runModelTurn(request: ModelRequest) {
      return invoke<ModelTurnResponse>("deepseek_tool_completion", { request });
    },
    getSourceLabel(sourceKind) {
      if (sourceKind === "desktop") return "桌面 vault";
      if (sourceKind === "structure") return "只读磁盘结构";
      return sourceKind === "empty" ? "未连接" : "本地知识库";
    }
  };
}

async function loadReadOnlyRoot(root: string): Promise<LoadedVault> {
  const listing = await invoke<ReadOnlyDirectoryListing>("list_directory_read_only", { root, path: "" });
  activeVaultPath = "";
  return {
    files: [],
    sourceName: root,
    sourceKind: "structure",
    safetyManifest: buildSafetyManifest([]),
    readOnlyStructure: {
      folderCount: listing.entries.filter((entry) => entry.kind === "directory").length,
      fileCount: listing.entries.filter((entry) => entry.kind === "file").length,
      truncated: listing.truncated,
      listing
    }
  };
}

async function loadVault(root: string): Promise<LoadedVault> {
  const files = await invoke<NoteFile[]>("load_vault_notes", { root });
  activeVaultPath = root;
  return {
    files,
    sourceName: root,
    sourceKind: "desktop",
    safetyManifest: buildSafetyManifest(files.map((file) => file.path))
  };
}

export async function writeChangesToVault(root: string, changes: DraftChange[]): Promise<WriteChangesResult> {
  for (const change of changes) {
    if (change.kind === "deleted") {
      await invoke("delete_note", { root, path: change.path });
      continue;
    }
    await invoke("save_note", { root, path: change.path, content: change.after ?? "" });
  }

  const reloaded = await loadVault(root);
  return {
    message: `已写回 ${changes.length} 个草稿到本地 vault。`,
    files: reloaded.files,
    safetyManifest: reloaded.safetyManifest
  };
}

async function writeChangesToVaultWithTrash(root: string, changes: DraftChange[]): Promise<WriteChangesResult> {
  for (const change of changes) {
    if (change.kind === "deleted") {
      await invoke("delete_note", { root, path: change.path });
      continue;
    }
    await invoke("save_note", { root, path: change.path, content: change.after ?? "" });
  }

  const reloaded = await loadVault(root);
  const trashEntries = await invoke<TrashEntry[]>("list_trash_entries", { root });
  return {
    message: `已写回 ${changes.length} 个改动到本地 vault。删除的文档已移入回收站并保留 30 天。`,
    files: reloaded.files,
    safetyManifest: reloaded.safetyManifest,
    trashEntries
  };
}
