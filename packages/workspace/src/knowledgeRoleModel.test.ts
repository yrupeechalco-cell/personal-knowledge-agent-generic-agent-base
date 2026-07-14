import { describe, expect, it } from "vitest";
import { buildVaultIndex, type NoteFile } from "@knowledge-agent/core";
import { buildKnowledgeRoleModel } from "./knowledgeRoleModel";

describe("buildKnowledgeRoleModel", () => {
  it("separates storage hierarchy from evidence-backed knowledge roles", () => {
    const files: NoteFile[] = [
      { path: "造车项目/整车目标.md", content: "# 整车目标\n\n决策依赖 [[润滑研究]] 和 [[道路实验]]。 #项目" },
      { path: "发动机/润滑研究.md", content: "# 润滑研究\n\n实验数据支持高温润滑方案。 #发动机" },
      { path: "验证/道路实验.md", content: "# 道路实验\n\n验证 [[润滑研究]] 的结论。 #发动机 #实验" },
      { path: "方法/实验规范.md", content: "# 实验规范\n\n道路实验方法。 #实验" }
    ];

    const model = buildKnowledgeRoleModel(buildVaultIndex(files));
    const project = model.domains.find((domain) => domain.id === "项目与产品");
    const research = model.domains.find((domain) => domain.id === "研究与阅读");

    expect(model.domains.length).toBeGreaterThanOrEqual(3);
    expect(project?.kind).toBe("project");
    expect(research?.contributions.some((contribution) => contribution.role === "evidence")).toBe(true);
    expect(model.domainRelations.some((relation) => relation.basis === "explicit-link")).toBe(true);
    expect(model.noteRelations.some((relation) => relation.basis === "shared-tag")).toBe(true);
  });

  it("uses tags as provisional domains when a tiny demo vault has no useful folders", () => {
    const model = buildKnowledgeRoleModel(
      buildVaultIndex([
        { path: "Demo/A.md", content: "# A\n#甲" },
        { path: "Demo/B.md", content: "# B\n#乙" },
        { path: "Demo/C.md", content: "# C\n#丙" }
      ])
    );

    expect(model.domains.map((domain) => domain.id).sort()).toEqual(["丙", "乙", "甲"]);
  });

  it("does not mistake AI notes containing app terms for a project domain", () => {
    const model = buildKnowledgeRoleModel(
      buildVaultIndex([{ path: "研究/多Agent工作流.md", content: "# 多 Agent 工作流\n\n让 Agent 操作 app 知识界面。" }])
    );

    expect(model.domains[0]).toMatchObject({ id: "AI 与智能体", kind: "topic" });
  });
});
