import { buildVaultIndex, type NoteFile } from "@knowledge-agent/core";
import { describe, expect, it } from "vitest";
import { buildKnowledgeRoleModel } from "./knowledgeRoleModel";
import { buildTagKnowledgeModel, buildTagRootDomain, domainNodeWeight, globalNodeScale, relationLineOpacity } from "./tagKnowledgeModel";

describe("tag knowledge model", () => {
  const files: NoteFile[] = [
    { path: "数学/导数.md", content: "---\ntags: [导数, 函数最值, 求导方法]\n---\n# 导数\n\n参见 [[闭区间题目]]。" },
    { path: "数学/闭区间题目.md", content: "---\ntags: [函数最值, 区间端点, 错题证据]\n---\n# 闭区间题目" },
    { path: "项目/优化案例.md", content: "---\ntags: [导数, 模型优化]\n---\n# 优化案例\n\n项目应用。" }
  ];

  it("uses editable tags as graph nodes and document co-occurrence as evidence", () => {
    const model = buildTagKnowledgeModel(buildVaultIndex(files));
    expect(model.nodes.map((node) => node.label)).toContain("导数");
    expect(model.nodes.map((node) => node.label)).not.toContain("数学");
    expect(model.relations.some((relation) => new Set([relation.source, relation.target]).has("函数最值") && new Set([relation.source, relation.target]).has("导数"))).toBe(true);
  });

  it("preserves source and application perspectives without changing tag identity", () => {
    const model = buildTagKnowledgeModel(buildVaultIndex(files));
    const derivative = model.nodes.find((node) => node.label === "导数");
    expect(derivative?.documentPaths).toHaveLength(2);
    expect(derivative?.dominantSource).toBe("数学");
    expect(domainNodeWeight(derivative!, "application")).toBeGreaterThan(0);
    expect(model.sourceCount).toBe(2);
  });

  it("keeps base node size and relation brightness independent from the active domain", () => {
    const model = buildTagKnowledgeModel(buildVaultIndex(files));
    const derivative = model.nodes.find((node) => node.label === "导数")!;
    const scale = globalNodeScale(derivative);

    for (const domain of ["classification", "context", "application", "source"] as const) {
      expect(globalNodeScale(derivative)).toBe(scale);
      expect(domainNodeWeight(derivative, domain)).toBeGreaterThanOrEqual(0);
    }
    expect(globalNodeScale({ ...derivative, weight: 1 }) - globalNodeScale({ ...derivative, weight: 0 })).toBeLessThanOrEqual(0.28);
    expect(relationLineOpacity(0)).toBe(0.05);
    expect(relationLineOpacity(1)).toBe(0.25);
  });

  it("builds a drill-down root from the documents behind a tag", () => {
    const index = buildVaultIndex(files);
    const tagModel = buildTagKnowledgeModel(index);
    const roleModel = buildKnowledgeRoleModel(index);
    const derivative = tagModel.nodes.find((node) => node.label === "导数")!;
    const root = buildTagRootDomain(derivative, roleModel);

    expect(root.label).toBe("导数");
    expect(root.notePaths).toEqual(expect.arrayContaining(["数学/导数.md", "项目/优化案例.md"]));
    expect(root.contributions.map((item) => item.path)).toEqual(expect.arrayContaining(root.notePaths));
  });
});
