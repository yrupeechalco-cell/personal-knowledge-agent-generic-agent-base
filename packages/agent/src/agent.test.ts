import { buildVaultIndex } from "@knowledge-agent/core";
import { describe, expect, it } from "vitest";
import { NoteAgentKernel, classifyEdit, classifyRestore, type ModelRequest } from ".";

const files = [
  { path: "AIGC/AIGC.md", content: "# AIGC\n[[AIGC/代码生成电音]]\n一些关于生成音乐和动画的笔记。" },
  { path: "AIGC/代码生成电音.md", content: "# 代码生成电音\n电音、音乐、生成。" },
  { path: "密码/账号密码.md", content: "# Secret" }
];

describe("NoteAgentKernel", () => {
  it("summarizes the current note with local tools", async () => {
    const index = buildVaultIndex(files);
    const agent = new NoteAgentKernel();
    const result = await agent.run("总结当前笔记", {
      currentPath: "AIGC/AIGC.md",
      files,
      index
    });

    expect(result.toolCalls).toContain("summarize_note");
    expect(result.message.content).toContain("AIGC");
    expect(result.diffs).toEqual([]);
  });

  it("creates MOC proposals with safety metadata", async () => {
    const index = buildVaultIndex(files);
    const agent = new NoteAgentKernel();
    const result = await agent.run("/moc", {
      currentPath: "AIGC/AIGC.md",
      files,
      index
    });

    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0].after).toContain("# AIGC MOC");
    expect(result.diffs[0].permission).toMatch(/auto|confirm/);
    expect(result.safetyManifest?.allowed.map((decision) => decision.path)).toEqual(["AIGC/AIGC.md"]);
  });

  it("passes current note context to the configured model provider", async () => {
    const index = buildVaultIndex(files);
    let captured: ModelRequest | undefined;
    const agent = new NoteAgentKernel({
      provider: {
        name: "test-provider",
        async generate(request) {
          captured = request;
          return "model answer";
        }
      }
    });

    const result = await agent.run("请分析这篇笔记", {
      currentPath: "AIGC/AIGC.md",
      files,
      index
    });

    expect(result.message.content).toBe("model answer");
    expect(captured?.model).toBe("deepseek-v4-pro");
    expect(captured?.thinking).toBe(true);
    expect(captured?.system).toContain("AIGC/AIGC.md");
    expect(captured?.system).toContain("Current note content");
  });

  it("executes model tool calls and returns the follow-up answer", async () => {
    const index = buildVaultIndex(files);
    const opened: string[] = [];
    let turn = 0;
    const agent = new NoteAgentKernel({
      provider: {
        name: "tool-provider",
        async generate() {
          return "";
        },
        async generateTurn(request) {
          turn += 1;
          if (turn === 1) {
            expect(request.tools?.map((tool) => tool.name)).toContain("app_open_note");
            return {
              content: "",
              toolCalls: [{ id: "call-1", name: "app_open_note", arguments: JSON.stringify({ path: "AIGC/AIGC.md" }) }]
            };
          }
          expect(request.messages.at(-1)).toMatchObject({ role: "tool", toolCallId: "call-1" });
          return { content: "已经打开目标笔记。", toolCalls: [] };
        }
      },
      tools: [
        {
          name: "app_open_note",
          description: "Open a note in the app.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
            additionalProperties: false
          },
          run(input) {
            opened.push((JSON.parse(input) as { path: string }).path);
            return "opened";
          }
        }
      ]
    });

    const result = await agent.run("打开 AIGC", {
      currentPath: "AIGC/AIGC.md",
      files,
      index
    });

    expect(opened).toEqual(["AIGC/AIGC.md"]);
    expect(result.toolCalls).toEqual(["app_open_note"]);
    expect(result.message.content).toBe("已经打开目标笔记。");
  });

  it("does not let natural-language graph requests bypass the model tool router", async () => {
    const index = buildVaultIndex(files);
    let modelCalled = false;
    const agent = new NoteAgentKernel({
      provider: {
        name: "tool-provider",
        async generate() {
          return "";
        },
        async generateTurn() {
          modelCalled = true;
          return { content: "已切换到关系图谱。", toolCalls: [] };
        }
      }
    });

    const result = await agent.run("给我生成一个复杂关系图谱", {
      currentPath: "AIGC/AIGC.md",
      files,
      index
    });

    expect(modelCalled).toBe(true);
    expect(result.toolCalls).not.toContain("build_graph");
    expect(result.message.content).toBe("已切换到关系图谱。");
  });

  it("runs the document generator only when the model explicitly selects that tool", async () => {
    const index = buildVaultIndex(files);
    let argumentsJson = "";
    let modelTurns = 0;
    const agent = new NoteAgentKernel({
      provider: {
        name: "tool-provider",
        async generate() {
          return "";
        },
        async generateTurn() {
          modelTurns += 1;
          if (modelTurns === 1) {
            return {
              content: "",
              toolCalls: [
                {
                  id: "call-1",
                  name: "app_generate_stress_graph",
                  arguments: JSON.stringify({ count: 12, folderName: "模型选择的测试库", topic: "复杂文档状态" })
                }
              ]
            };
          }
          return { content: "已按你的要求生成复杂文档测试库。", toolCalls: [] };
        }
      },
      tools: [
        {
          name: "app_generate_stress_graph",
          description: "Generate linked test documents.",
          parameters: { type: "object", properties: {} },
          run(input) {
            argumentsJson = input;
            return "generated";
          }
        }
      ]
    });

    const result = await agent.run("随机生成关系图谱，要有实际文件夹和文档，模拟高复杂内容下的 App 运行工况", {
      currentPath: "AIGC/AIGC.md",
      files,
      index
    });

    expect(modelTurns).toBe(2);
    expect(result.toolCalls).toEqual(["app_generate_stress_graph"]);
    expect(JSON.parse(argumentsJson)).toMatchObject({ count: 12, folderName: "模型选择的测试库" });
    expect(result.message.content).toBe("已按你的要求生成复杂文档测试库。");
  });
});

describe("classifyEdit", () => {
  it("blocks sensitive paths and requires confirmation for large edits", () => {
    expect(classifyEdit("a", "b", "密码/账号.md").permission).toBe("blocked");
    expect(classifyEdit("line\n".repeat(50), "short", "A.md").permission).toBe("confirm");
    expect(classifyEdit("hello", "hello world", "A.md").permission).toBe("auto");
  });
});

describe("classifyRestore", () => {
  it("keeps recovery authority inside Agent permission rules", () => {
    expect(classifyRestore("A.md", 2_000, 1_000)).toEqual({
      permission: "confirm",
      reason: "restore changes the local vault and requires Agent recovery authorization"
    });
    expect(classifyRestore("密码/账号.md", 2_000, 1_000).permission).toBe("blocked");
    expect(classifyRestore("A.md", 1_000, 1_000).permission).toBe("blocked");
  });
});
