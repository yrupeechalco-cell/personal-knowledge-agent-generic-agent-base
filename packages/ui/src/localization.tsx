import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";

export type AppLocale = "zh-CN" | "en";
export type TranslationValues = Record<string, string | number>;

const LOCALE_STORAGE_KEY = "knowledge-agent.locale";

const ENGLISH_MESSAGES: Record<string, string> = {
  "切换侧栏": "Toggle sidebar",
  "存储空间": "Storage",
  "搜索": "Search",
  "笔记": "Notes",
  "只读来源不能新建笔记": "New notes are disabled for read-only sources",
  "新建笔记": "New note",
  "保存中": "Saving",
  "改动": "Changes",
  "回收站": "Trash",
  "未连接": "Disconnected",
  "未连接知识库": "No knowledge base connected",
  "本地知识库": "Local knowledge base",
  "本地 vault": "Local vault",
  "GitHub 公开库 · 只读": "Public GitHub repository · Read only",
  "工具栏": "Toolbar",
  "关系图谱": "Relationship graph",
  "资源查询": "Resource explorer",
  "设置": "Settings",
  "打开本地知识库": "Open local knowledge base",
  "新建会话笔记": "New note tab",
  "磁盘结构": "Disk structure",
  "公开知识库": "Public knowledge base",
  "读书": "Library",
  "筛选笔记": "Filter notes",
  "标签": "Tags",
  "暂无标签": "No tags",
  "安全状态": "Safety",
  "只读": "Read only",
  "已排除": "Excluded",
  "仅枚举名称、路径和层级；正文读取与写入均已关闭。": "Only names, paths, and hierarchy are listed. Content reading and all writes are disabled.",
  "调整左侧栏宽度": "Resize left sidebar",
  "调整右侧 Agent 栏宽度": "Resize Agent sidebar",
  "后退": "Back",
  "前进": "Forward",
  "开始": "Start",
  "知识作用图谱": "Knowledge impact map",
  "文件关系图谱": "File relationship graph",
  "只读文件浏览": "Read-only file browser",
  "图谱观察方式": "Graph perspective",
  "知识地形": "Knowledge terrain",
  "文件关系": "File relationships",
  "正在构建知识地形": "Building knowledge terrain",
  "图谱设置": "Graph settings",
  "筛选": "Filter",
  "筛选图谱节点": "Filter graph nodes",
  "节点标题或路径": "Node title or path",
  "显示": "Display",
  "显示标签": "Show labels",
  "显示孤立节点": "Show isolated nodes",
  "力": "Physics",
  "关系半径": "Relationship radius",
  "图谱关系半径": "Graph relationship radius",
  "关闭菜单": "Close menu",
  "在本文档中新建": "Create inside this document",
  "重命名": "Rename",
  "复制": "Copy",
  "剪切": "Cut",
  "粘贴到这里": "Paste here",
  "删除": "Delete",
  "确认删除图谱文档": "Confirm graph document deletion",
  "关闭": "Close",
  "确认移除这些文档？": "Remove these documents?",
  "确认移除这个文档？": "Remove this document?",
  "这一步只会加入回收站待写回；写回本地后会移入 .knowledge-agent-trash，并保留 30 天。": "This only stages the documents for Trash. After local write-back they move to .knowledge-agent-trash and are retained for 30 days.",
  "取消": "Cancel",
  "加入回收站": "Move to Trash",
  "配置 DeepSeek API key": "Configure DeepSeek API key",
  "首次使用在线 Agent": "First use of the online Agent",
  "填写你的 DeepSeek API key": "Enter your DeepSeek API key",
  "API key 只保存在本机 AppData，不会写入知识库或 GitHub。": "The API key is stored only in local AppData and is never written to your knowledge base or GitHub.",
  "稍后": "Later",
  "保存并启用": "Save and enable",
  "本地存储空间": "Local storage",
  "关闭存储面板": "Close storage panel",
  "本机磁盘": "Local drives",
  "此电脑": "This PC",
  "打开已有文件夹": "Open existing folder",
  "选择其他位置只读浏览": "Browse another location read only",
  "GitHub 公开知识库": "Public GitHub knowledge base",
  "只读 · 无需登录": "Read only · No sign-in required",
  "GitHub 公开仓库地址": "Public GitHub repository address",
  "owner/repo 或 GitHub 仓库网址": "owner/repo or GitHub repository URL",
  "打开": "Open",
  "打开官方示例知识库": "Open official example knowledge base",
  "读取公开仓库中的安全 Markdown 并建立文件树与图谱；不会提交、删除或改写仓库内容。": "Read safe Markdown from a public repository and build its file tree and graph. The repository is never committed to, deleted from, or rewritten.",
  "新建文件夹名称": "New folder name",
  "选择位置并新建": "Choose location and create",
  "只读扫描不会读取文件正文、不会创建草稿、不会写入或删除所选目录中的任何文件。": "Read-only scanning does not read file content, create drafts, write files, or delete anything in the selected directory.",
  "浏览器入口只能打开授权文件夹；只读磁盘结构扫描和新建任意本机文件夹请使用桌面 App。": "The browser can only open folders you authorize. Use the desktop App to scan disk structure or create folders anywhere.",
  "关闭改动面板": "Close changes panel",
  "当前没有草稿改动。": "There are no draft changes.",
  "正在写回...": "Writing back...",
  "写回本地": "Write to local files",
  "仅桌面端可写回": "Write-back is desktop only",
  "改动与回收站": "Changes and Trash",
  "关闭改动与回收站面板": "Close changes and Trash panel",
  "当前没有待写回改动。": "There are no pending changes.",
  ".knowledge-agent-trash · 保留 30 天，到期自动清理": ".knowledge-agent-trash · Retained for 30 days, then removed automatically",
  "回收站为空。": "Trash is empty.",
  "已阻止": "Blocked",
  "恢复中": "Restoring",
  "恢复": "Restore",
  "Agent 审核": "Agent review",
  "连接你的知识库": "Connect your knowledge base",
  "打开一个存放 Markdown 文档的普通文件夹。新安装的应用和网站不会预置、复制或上传任何笔记。": "Open any regular folder containing Markdown documents. A new App installation or website session never bundles, copies, or uploads notes.",
  "新建知识库文件夹": "Create knowledge base folder",
  "只有你主动选择的文件夹会被读取。": "Only folders you explicitly choose are read.",
  "当前浏览器不支持文件夹选择器，请使用最新版 Chrome 或 Edge。": "This browser does not support folder selection. Use the latest Chrome or Edge.",
  "当前磁盘目录": "Current disk directory",
  "只读文件浏览器": "Read-only file browser",
  "上一级": "Parent folder",
  "刷新当前目录": "Refresh current folder",
  "当前文件路径": "Current file path",
  "搜索当前目录": "Search current folder",
  "文件和文件夹": "Files and folders",
  "名称": "Name",
  "类型": "Type",
  "大小": "Size",
  "修改时间": "Modified",
  "当前目录没有匹配项。": "No matching items in this folder.",
  "当前目录超过 1000 项，仅显示前 1000 项。进入子文件夹可继续浏览。": "This folder has more than 1,000 items. Only the first 1,000 are shown; open a subfolder to continue.",
  "只读文件预览": "Read-only file preview",
  "只读预览": "Read-only preview",
  "关闭预览": "Close preview",
  "位置": "Location",
  "修改": "Modified",
  "（文档没有可显示的文字内容）": "(This document has no displayable text content.)",
  "本视图没有写入、重命名或删除权限": "This view has no write, rename, or delete permission",
  "文件夹": "Folder",
  "符号链接": "Symbolic link",
  "其他": "Other",
  "文件": "File",
  "搜索标题、路径、标签或正文": "Search titles, paths, tags, or content",
  "全部文档": "All documents",
  "文档列表": "Document list",
  "没有匹配的文档。": "No matching documents.",
  "选择一篇笔记开始。": "Select a note to begin.",
  "编辑": "Edit",
  "阅读": "Read",
  "当前笔记关系小图": "Current note mini graph",
  "拖拽图谱节点到这里删除": "Drag graph nodes here to delete",
  "添加当前笔记到 Agent 上下文": "Add current note to Agent context",
  "模型连接状态": "Model connection status",
  "Agent 设置": "Agent settings",
  "Agent 设置：模型、推理强度和权限": "Agent settings: model, reasoning effort, and permissions",
  "需要填写本机 DeepSeek API key 后才能使用在线模型。": "Enter a local DeepSeek API key to use an online model.",
  "只读磁盘结构模式：Agent 已暂停，不会读取正文、创建草稿或执行本地操作。": "Read-only disk structure mode: the Agent is paused and cannot read content, create drafts, or perform local actions.",
  "子 Agent 会话": "Sub-agent sessions",
  "切换到子 Agent": "Switch to sub-agent",
  "Agent 工具": "Agent tools",
  "新建子智能体": "New sub-agent",
  "新建子智能体：开启一个独立聊天": "New sub-agent: start an independent conversation",
  "刷新当前聊天": "Reset current conversation",
  "刷新当前聊天：清空当前 Agent 会话": "Reset current conversation: clear this Agent session",
  "回溯最近聊天": "Restore recent conversation",
  "回溯最近聊天：恢复上一段 Agent 会话和记忆": "Restore the previous Agent session and its memory",
  "只读磁盘结构模式已暂停 Agent": "The Agent is paused in read-only disk structure mode",
  "模型状态": "Model status",
  "关闭 Agent 设置": "Close Agent settings",
  "切换模型、笔记 Agent 模式和本机模型连接。": "Switch the model, note Agent mode, and local model connection.",
  "模型": "Model",
  "模型连接": "Model connection",
  "本机密钥已保存": "Local key saved",
  "未配置密钥": "No key configured",
  "配置": "Configure",
  "知识地形尚未形成": "Knowledge terrain has not formed yet",
  "当前知识库没有可分析的 Markdown 文档。": "This knowledge base has no Markdown documents to analyze.",
  "宏观知识地形": "Macro knowledge terrain",
  "知识领域类型": "Knowledge domain types",
  "项目": "Project",
  "专题": "Topic",
  "方法": "Method",
  "资料": "Reference",
  "返回宏观知识地形": "Back to macro knowledge terrain",
  "领域影响": "Domain impact",
  "原文双链": "Explicit wiki link",
  "待确认关联": "Suggested relationship",
  "结构": "Structure",
  "证据": "Evidence",
  "独特": "Uniqueness",
  "问题": "Question",
  "决策": "Decision",
  "成果": "Output",
  "背景": "Background",
  "知识专题": "Knowledge topic",
  "方法体系": "Method system",
  "资料集合": "Reference collection",
  "复杂整理、长上下文分析、重要写作提案。": "Complex organization, long-context analysis, and substantial writing proposals.",
  "快速总结、轻量问答、低延迟浏览辅助。": "Fast summaries, lightweight Q&A, and low-latency browsing assistance.",
  "日常笔记 Agent": "Daily note Agent",
  "围绕当前笔记做总结、问答、轻量改写和安全提案。": "Summarize, answer questions, lightly rewrite, and propose safe changes around the current note.",
  "整理归档 Agent": "Organization Agent",
  "更关注标题、层级、MOC、目录和跨文件整理建议。": "Focus on titles, hierarchy, MOCs, indexes, and cross-file organization.",
  "建链图谱 Agent": "Link graph Agent",
  "更关注双链、反链、未解析概念和语义关系候选。": "Focus on links, backlinks, unresolved concepts, and semantic relationship candidates.",
  "仅使用本地笔记工具，不调用在线模型。": "Use local note tools only; do not call an online model.",
  "尚未连接知识库。请选择一个 Markdown 文件夹开始使用。": "No knowledge base is connected. Choose a Markdown folder to begin.",
  "知识库已载入。": "Knowledge base loaded.",
  "未能载入知识库。": "Could not load the knowledge base.",
  "当前入口不支持读取 GitHub 公开仓库。": "This application entry does not support public GitHub repositories.",
  "请输入 GitHub 公开仓库地址或 owner/repo。": "Enter a public GitHub repository URL or owner/repo.",
  "正在从 GitHub 读取公开知识库的文件树和 Markdown 正文...": "Reading the public repository file tree and Markdown content from GitHub...",
  "GitHub 公开库读取失败。": "Could not read the public GitHub repository.",
  "当前入口不支持只读磁盘结构扫描；请使用桌面 App。": "This entry does not support read-only disk scanning. Use the desktop App.",
  "当前入口不支持新建本地文件夹；请在桌面 App 中使用。": "This entry cannot create local folders. Use the desktop App.",
  "当前来源为只读模式。请打开本地知识库后再新建或修改文档。": "This source is read only. Open a local knowledge base before creating or editing documents.",
  "当前来源为只读模式，不能删除文档。": "Documents cannot be deleted from a read-only source.",
  "当前来源为只读模式，不支持删除。原始文件未被修改。": "Deletion is disabled for this read-only source. Original files were not changed.",
  "当前来源为只读模式，不能写回文件。": "Files cannot be written back to a read-only source.",
  "当前没有需要写回的草稿。": "There are no drafts to write back.",
  "正在思考…你可以继续浏览、编辑或操作图谱。": "Thinking... You can continue browsing, editing, or using the graph.",
  "左键进入，右键删除": "Left-click to open; right-click to delete",
  "待创建": "Not created yet",
  "文档": "Document",
  "将单个图谱节点拖到这里删除": "Drag a single graph node here to delete it",
  "知识根系": "Knowledge root map",
  "关系置信度": "Relationship confidence",
  "相对贡献": "Relative contribution",
  "加入 Agent 上下文": "Add to Agent context",
  "当前没有可上传的笔记": "No note is available to add",
  "{path} 被安全规则阻止：{reason}": "{path} was blocked by a safety rule: {reason}",
  "删除时间：{deleted} · 到期时间：{expires}": "Deleted: {deleted} · Expires: {expires}",
  "请先处理待写回改动，再恢复回收站文档": "Resolve pending write-back changes before restoring this document",
  "Agent 已授权，恢复到原路径": "Authorized by the Agent; restore to the original path",
  "交给 Agent 审核回溯权限": "Ask the Agent to review restore permission",
  "暂时无法检查更新": "Unable to check for updates right now",
  "更新安装失败，请稍后再试": "The update could not be installed. Please try again later.",
  "更新检查未完成": "Update check did not complete",
  "稍后提醒": "Remind me later",
  "包含最新功能、体验改进与问题修复。": "Includes the latest features, experience improvements, and fixes.",
  "正在下载安装包…": "Downloading the update...",
  "更新下载进度": "Update download progress",
  "更新将在应用重新启动后完整生效。": "The update will take full effect after the App restarts.",
  "立即更新": "Update now",
  "重新检查": "Check again",
  "知道了": "Got it",
  "未知": "Unknown",
  "根目录": "Root"
};

interface LocalizationContextValue {
  locale: AppLocale;
  setLocale(locale: AppLocale): void;
  t(source: string, values?: TranslationValues): string;
  runtime(source: string): string;
}

const defaultContext: LocalizationContextValue = {
  locale: "zh-CN",
  setLocale: () => undefined,
  t: (source, values) => interpolate(source, values),
  runtime: (source) => source
};

const LocalizationContext = createContext<LocalizationContextValue>(defaultContext);

export function LanguageProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: AppLocale }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => initialLocale ?? detectPreferredLocale());

  useLayoutEffect(() => {
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
    document.title = locale === "en" ? "Personal Knowledge Agent" : "个人知识库 Agent";
  }, [locale]);

  const value = useMemo<LocalizationContextValue>(() => ({
    locale,
    setLocale(nextLocale) {
      setLocaleState(nextLocale);
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
        const url = new URL(window.location.href);
        url.searchParams.set("lang", nextLocale === "en" ? "en" : "zh");
        window.history.replaceState(null, "", url);
      } catch {
        // Language selection still works for the current session.
      }
    },
    t(source, values) {
      return translateText(source, locale, values);
    },
    runtime(source) {
      return translateRuntimeText(source, locale);
    }
  }), [locale]);

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization(): LocalizationContextValue {
  return useContext(LocalizationContext);
}

export function detectPreferredLocale(options: {
  search?: string;
  storedLocale?: string | null;
  browserLanguages?: readonly string[];
} = {}): AppLocale {
  const search = options.search ?? (typeof window === "undefined" ? "" : window.location.search);
  const queryLocale = new URLSearchParams(search).get("lang")?.toLowerCase();
  if (queryLocale === "en" || queryLocale?.startsWith("en-")) return "en";
  if (queryLocale === "zh" || queryLocale?.startsWith("zh-")) return "zh-CN";

  let storedLocale = options.storedLocale;
  if (storedLocale === undefined && typeof window !== "undefined") {
    try {
      storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      storedLocale = null;
    }
  }
  if (storedLocale === "en" || storedLocale === "zh-CN") return storedLocale;

  const browserLanguages = options.browserLanguages ?? (typeof navigator === "undefined" ? [] : navigator.languages);
  return browserLanguages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}

export function translateText(source: string, locale: AppLocale, values?: TranslationValues): string {
  const template = locale === "en" ? ENGLISH_MESSAGES[source] ?? source : source;
  return interpolate(template, values);
}

export function translateRuntimeText(source: string, locale: AppLocale): string {
  if (locale !== "en" || !source) return source;
  const exact = ENGLISH_MESSAGES[source];
  if (exact) return exact;

  const rules: Array<[RegExp, string]> = [
    [/^已只读载入 (.+)：(\d+) 篇 Markdown。$/, "Loaded $1 read only: $2 Markdown documents."],
    [/^已只读载入 (.+)：(\d+) 篇 Markdown，排除 (\d+) 个路径。$/, "Loaded $1 read only: $2 Markdown documents; $3 paths excluded."],
    [/^已载入 (.+)。$/, "Loaded $1."],
    [/^已连接 (.+)，读取 (\d+) 篇安全笔记，排除 (\d+) 个路径。$/, "Connected to $1: $2 safe notes loaded; $3 paths excluded."],
    [/^正在以只读方式打开 (.+)\.\.\.$/, "Opening $1 read only..."],
    [/^已以只读方式打开 (.+)。点击文件夹继续浏览，点击文件查看预览。$/, "Opened $1 read only. Open folders to browse and files to preview."],
    [/^无法打开 (.+)：(.+)$/, "Could not open $1: $2"],
    [/^只读预览：(.+) · (.+)。未修改原始文件。$/, "Read-only preview: $1 · $2. The original file was not changed."],
    [/^GitHub 公开库读取失败：(.+)$/, "Could not read the public GitHub repository: $1"],
    [/^公开仓库只读：允许 (\d+) \/ 排除 (\d+)$/, "Public repository read only: $1 allowed / $2 excluded"],
    [/^允许 (\d+) \/ 排除 (\d+)$/, "$1 allowed / $2 excluded"],
    [/^会话改动 (\d+) \/ 阻止 (\d+)$/, "Session changes $1 / blocked $2"],
    [/^当前模型：(.+)$/, "Current model: $1"],
    [/^上下文：约 (.+) \/ (.+) tokens；包含聊天、当前笔记、上传笔记和 vault 概览。$/, "Context: about $1 / $2 tokens, including chat, the current note, attached notes, and the knowledge base overview."],
    [/^(\d+) 个领域 · (\d+) 条跨域依据$/, "$1 domains · $2 cross-domain evidence links"],
    [/^(\d+) 篇文档 · 影响 (\d+) · 依据置信度 (\d+)%$/, "$1 documents · impact $2 · evidence confidence $3%"],
    [/^定义问题；被 (\d+) 篇文档依赖，并连接 (\d+) 个依据。$/, "Defines the problem; referenced by $1 documents and connected to $2 evidence links."],
    [/^提供证据；连接 (\d+) 个依据，并支撑当前领域。$/, "Provides evidence through $1 links and supports this domain."],
    [/^支撑决策；连接 (\d+) 个依据，并影响当前领域。$/, "Supports decisions through $1 links and influences this domain."],
    [/^沉淀成果；被 (\d+) 篇文档依赖，并形成可复用输出。$/, "Captures an output referenced by $1 documents and turns it into reusable knowledge."],
    [/^补充背景；提供 (\d+) 个连接与上下文。$/, "Adds background context through $1 connections."],
    [/^当前核心：(.+)$/, "Current core: $1"],
    [/^(.+) · 关系置信度 (\d+)%$/, "$1 · relationship confidence $2%"],
    [/^(\d+) 篇$/, "$1 docs"],
    [/^已框选 (\d+) 篇文档$/, "$1 documents selected"],
    [/^(\d+) 个已框选路径$/, "$1 selected paths"],
    [/^剩余 (\d+) 天 (\d+) 小时$/, "$1 days $2 hours remaining"],
    [/^剩余 (\d+) 小时$/, "$1 hours remaining"],
    [/^已到期，下一次刷新会清理$/, "Expired; it will be removed on the next refresh"],
    [/^(.+) 文件$/, "$1 file"]
  ];
  for (const [pattern, replacement] of rules) {
    if (pattern.test(source)) return source.replace(pattern, replacement);
  }
  return source;
}

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) => String(values[key] ?? match));
}
