import { describe, expect, it } from "vitest";
import type { NoteFile } from "@knowledge-agent/core";
import {
  buildDraftChanges,
  buildStressGraphNotes,
  agentMutationApprovalFor,
  createEmptyVault,
  detectInterlinkedVaultRequest,
  detectWordDocumentRequest,
  removeAgentConversationSession,
  selectAutoSaveChanges,
  updateConversationById
} from "./KnowledgeWorkspace";

describe("createEmptyVault", () => {
  it("contains no bundled notes or allowed paths", () => {
    const vault = createEmptyVault();

    expect(vault.sourceKind).toBe("empty");
    expect(vault.sourceName).toBe("未连接知识库");
    expect(vault.files).toEqual([]);
    expect(vault.safetyManifest.allowed).toEqual([]);
    expect(vault.safetyManifest.excluded).toEqual([]);
  });
});

describe("buildDraftChanges", () => {
  it("classifies created, modified, and deleted notes", () => {
    const baseFiles: NoteFile[] = [
      { path: "A.md", content: "# A" },
      { path: "B.md", content: "# B" }
    ];
    const files: NoteFile[] = [
      { path: "A.md", content: "# A\n\nchanged" },
      { path: "C.md", content: "# C" }
    ];

    expect(buildDraftChanges(baseFiles, files)).toEqual([
      { path: "A.md", kind: "modified", before: "# A", after: "# A\n\nchanged" },
      { path: "B.md", kind: "deleted", before: "# B" },
      { path: "C.md", kind: "created", after: "# C" }
    ]);
  });
});

describe("updateConversationById", () => {
  it("keeps an async result attached to the session that started the task", () => {
    const sessions = [
      { id: "agent-1", messages: ["question"] },
      { id: "agent-2", messages: ["other session"] }
    ];

    const updated = updateConversationById(sessions, "agent-1", (session) => ({
      ...session,
      messages: [...session.messages, "answer"]
    }));

    expect(updated).toEqual([
      { id: "agent-1", messages: ["question", "answer"] },
      { id: "agent-2", messages: ["other session"] }
    ]);
  });
});

describe("buildStressGraphNotes", () => {
  it("creates nested, content-rich, densely linked Markdown notes", () => {
    const notes = buildStressGraphNotes("压力测试库", 30, "知识系统");

    expect(notes).toHaveLength(30);
    expect(new Set(notes.map((note) => note.path.split("/")[1])).size).toBeGreaterThan(4);
    expect(notes[0].content).toContain("结构索引");
    expect(notes[0].content.match(/\[\[/g)?.length).toBe(29);
    expect(notes.slice(1).every((note) => note.content.includes("## 核心内容") && note.content.includes("## 关联"))).toBe(true);
  });
});

describe("detectInterlinkedVaultRequest", () => {
  it("recognizes a local F drive request for interlinked notes", () => {
    expect(detectInterlinkedVaultRequest("帮我建立三十个互相有关联的文件，地方放开f盘新建一个文件夹")).toEqual({
      parentPath: "F:\\",
      folderName: "知识库Agent互联测试库",
      count: 30
    });
  });

  it("ignores ordinary Agent questions", () => {
    expect(detectInterlinkedVaultRequest("总结当前笔记")).toBeNull();
  });
});

describe("detectWordDocumentRequest", () => {
  it("recognizes a desktop Word document creation request", () => {
    expect(detectWordDocumentRequest("给我在桌面建立一个新的word文档名字叫张凯瑞")).toEqual({
      name: "张凯瑞"
    });
  });

  it("does not treat ordinary note requests as Word document creation", () => {
    expect(detectWordDocumentRequest("在当前笔记里写一下张凯瑞")).toBeNull();
  });
});

describe("removeAgentConversationSession", () => {
  it("removes the right-clicked session, reindexes labels, and selects its neighbor", () => {
    const result = removeAgentConversationSession(
      [
        { id: "agent-1", label: "1" },
        { id: "agent-2", label: "2" },
        { id: "agent-3", label: "3" }
      ],
      "agent-2",
      "agent-2"
    );

    expect(result).toEqual({
      sessions: [
        { id: "agent-1", label: "1" },
        { id: "agent-3", label: "2" }
      ],
      nextActiveSessionId: "agent-3"
    });
  });
});

describe("selectAutoSaveChanges", () => {
  it("persists creates and edits automatically but leaves deletion for the trash confirmation", () => {
    expect(
      selectAutoSaveChanges([
        { path: "created.md", kind: "created", after: "# created" },
        { path: "changed.md", kind: "modified", before: "# old", after: "# new" },
        { path: "deleted.md", kind: "deleted", before: "# deleted" }
      ])
    ).toEqual([
      { path: "created.md", kind: "created", after: "# created" },
      { path: "changed.md", kind: "modified", before: "# old", after: "# new" }
    ]);
  });
});

describe("agentMutationApprovalFor", () => {
  it("grants direct Agent writes only for explicit create or delete document instructions", () => {
    expect(agentMutationApprovalFor("请创建一个项目计划文档")).toEqual({ create: true, delete: false, restore: false });
    expect(agentMutationApprovalFor("删除这个笔记文件")).toEqual({ create: false, delete: true, restore: false });
    expect(agentMutationApprovalFor("撤回刚才删除的文档")).toEqual({ create: false, delete: false, restore: true });
    expect(agentMutationApprovalFor("总结当前笔记")).toEqual({ create: false, delete: false, restore: false });
  });
});
