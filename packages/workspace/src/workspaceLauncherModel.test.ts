import { describe, expect, it } from "vitest";
import { parseNote } from "@knowledge-agent/core";
import {
  buildQuickSwitcherItems,
  filterLauncherItems,
  searchVaultNotes,
  type WorkspaceLauncherItem
} from "./workspaceLauncherModel";

const notes = [
  parseNote({
    path: "项目/发动机.md",
    content: "---\naliases: [动力核心]\nstatus: draft\ntags: [车辆, 项目]\n---\n# 发动机\n\n润滑系统与温度控制。\n- [ ] 检查机油"
  }),
  parseNote({
    path: "学习/线性代数.md",
    content: "# 线性代数\n\n矩阵、向量和特征值。\n- [x] 完成第一章"
  })
];

describe("workspace launcher model", () => {
  it("fuzzy matches command labels and promotes recent commands", () => {
    const items: WorkspaceLauncherItem[] = [
      { id: "graph", kind: "command", label: "打开关系图谱", keywords: ["network"] },
      { id: "daily", kind: "command", label: "打开今日笔记", keywords: ["today"] }
    ];

    expect(filterLauncherItems(items, "gph").map((item) => item.id)).toEqual(["graph"]);
    expect(filterLauncherItems(items, "", ["daily"]).map((item) => item.id)).toEqual(["daily", "graph"]);
  });

  it("finds notes by title, path and aliases and offers exact creation", () => {
    expect(buildQuickSwitcherItems(notes, "动力", true).at(0)?.path).toBe("项目/发动机.md");
    expect(buildQuickSwitcherItems(notes, "新课题", true).at(-1)).toMatchObject({
      kind: "create",
      path: "新课题.md"
    });
  });

  it("supports Obsidian-style search fields, tasks, properties, negation and OR", () => {
    expect(searchVaultNotes(notes, 'path:项目 content:"润滑系统"')).toHaveLength(1);
    expect(searchVaultNotes(notes, "tag:#车辆")).toHaveLength(1);
    expect(searchVaultNotes(notes, "task-todo:机油")).toHaveLength(1);
    expect(searchVaultNotes(notes, "[status:draft]")).toHaveLength(1);
    expect(searchVaultNotes(notes, "矩阵 -机油")).toHaveLength(1);
    expect(searchVaultNotes(notes, "润滑 OR 特征值")).toHaveLength(2);
  });
});
