import type { AgentMessage, ModelProvider, ModelRequest } from "./types";

export class OfflineModelProvider implements ModelProvider {
  name = "offline";

  async generate(request: ModelRequest): Promise<string> {
    const lastUserMessage = [...request.messages].reverse().find((message) => message.role === "user");
    return `离线模式已接收任务：${lastUserMessage?.content ?? "无输入"}。我会优先使用本地工具完成摘要、搜索、建链和提案。`;
  }
}

export class OpenAICompatibleProvider implements ModelProvider {
  name = "openai-compatible";

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      defaultModel: string;
    }
  ) {}

  async generate(request: ModelRequest): Promise<string> {
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify({
        model: request.model ?? this.options.defaultModel,
        messages: [
          { role: "system", content: request.system },
          ...request.messages.map(toProviderMessage)
        ],
        temperature: 0.2,
        stream: false,
        ...(request.thinking ? { thinking: { type: "enabled" }, reasoning_effort: request.reasoningEffort ?? "high" } : {})
      })
    });

    if (!response.ok) {
      throw new Error(`Model request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? "";
  }
}

export function createDeepSeekProvider(apiKey?: string): ModelProvider {
  if (!apiKey) return new OfflineModelProvider();
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-pro"
  });
}

function toProviderMessage(message: AgentMessage): { role: "user" | "assistant"; content: string } {
  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content
  };
}
