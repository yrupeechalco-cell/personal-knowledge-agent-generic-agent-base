import {
  Bot,
  FolderCog,
  GitBranch,
  Keyboard,
  Languages,
  LayoutDashboard,
  Moon,
  Palette,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  useLocalization,
  type AgentSelectOption,
  type AppLocale
} from "@knowledge-agent/ui";
import type { AppTheme } from "./themeModel";
import {
  isAssignableShortcut,
  shortcutConflict,
  shortcutFromKeyboardEvent,
  type ResolvedShortcutMap,
  type ShortcutCategory,
  type ShortcutCommandId
} from "./shortcutModel";

export type AppSettingsSection =
  | "general"
  | "appearance"
  | "notes"
  | "graph"
  | "agent"
  | "shortcuts"
  | "updates";

export interface SettingsShortcutCommand {
  id: ShortcutCommandId;
  label: string;
  detail?: string;
  category: ShortcutCategory;
  shortcuts: string[];
  defaults: readonly string[];
}

interface AppSettingsDialogProps {
  activeSection: AppSettingsSection;
  agentModeOptions: AgentSelectOption[];
  appTheme: AppTheme;
  canConfigureModel: boolean;
  graphFilter: string;
  graphRadius: number;
  graphShowLabels: boolean;
  graphShowRelated: boolean;
  locale: AppLocale;
  modelConnectionDescription?: string;
  modelConfigured: boolean;
  modelCredentialBusy: boolean;
  modelCredentialStatus: "unchecked" | "valid" | "invalid";
  modelOptions: AgentSelectOption[];
  modelProvider: string;
  open: boolean;
  selectedAgentMode: string;
  selectedModel: string;
  shortcutMap: ResolvedShortcutMap;
  shortcuts: SettingsShortcutCommand[];
  sourceName: string;
  onAgentModeChange(mode: string): void;
  onClose(): void;
  onDeleteApiKey(): void;
  onGraphFilterChange(value: string): void;
  onGraphRadiusChange(value: number): void;
  onGraphShowLabelsChange(value: boolean): void;
  onGraphShowRelatedChange(value: boolean): void;
  onLocaleChange(locale: AppLocale): void;
  onModelChange(model: string): void;
  onOpenFormatConverter(): void;
  onOpenLayouts(): void;
  onOpenNoteWorkflow(): void;
  onOpenStorage(): void;
  onOpenTrash(): void;
  onOpenUpdates(): void;
  onRequestApiKey(): void;
  onResetAllShortcuts(): void;
  onResetShortcut(commandId: ShortcutCommandId): void;
  onSectionChange(section: AppSettingsSection): void;
  onShortcutChange(commandId: ShortcutCommandId, shortcuts: string[]): void;
  onThemeChange(theme: AppTheme): void;
  onValidateApiKey(): void;
}

const SECTION_ITEMS: Array<{
  id: AppSettingsSection;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "general", label: "常规", icon: LayoutDashboard },
  { id: "appearance", label: "外观与语言", icon: Palette },
  { id: "notes", label: "笔记与文件", icon: FolderCog },
  { id: "graph", label: "图谱与画布", icon: GitBranch },
  { id: "agent", label: "智能体", icon: Bot },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "updates", label: "更新与安全", icon: ShieldCheck }
];

const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  navigation: "导航",
  notes: "笔记",
  views: "视图",
  workspace: "工作区",
  agent: "智能体",
  settings: "设置"
};

export function AppSettingsDialog(props: AppSettingsDialogProps) {
  const { runtime, t } = useLocalization();
  const [shortcutQuery, setShortcutQuery] = useState("");
  const [recordingId, setRecordingId] = useState<ShortcutCommandId | null>(null);
  const [shortcutError, setShortcutError] = useState("");
  const recordingButtonRef = useRef<HTMLButtonElement>(null);
  const commandLabels = useMemo(
    () => new Map(props.shortcuts.map((command) => [command.id, command.label])),
    [props.shortcuts]
  );
  const filteredShortcuts = useMemo(() => {
    const query = shortcutQuery.trim().toLocaleLowerCase();
    if (!query) return props.shortcuts;
    return props.shortcuts.filter((command) =>
      [command.label, command.detail, CATEGORY_LABELS[command.category], command.shortcuts.join(" ")]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(query)
    );
  }, [props.shortcuts, shortcutQuery]);

  useEffect(() => {
    if (!props.open) return;
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (recordingId) {
        setRecordingId(null);
        setShortcutError("");
        return;
      }
      props.onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [props, recordingId]);

  useEffect(() => {
    if (recordingId) requestAnimationFrame(() => recordingButtonRef.current?.focus());
  }, [recordingId]);

  if (!props.open) return null;

  function recordShortcut(event: KeyboardEvent<HTMLButtonElement>, commandId: ShortcutCommandId) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecordingId(null);
      setShortcutError("");
      return;
    }
    const shortcut = shortcutFromKeyboardEvent(event);
    if (!shortcut) return;
    if (!isAssignableShortcut(shortcut)) {
      setShortcutError(t("快捷键必须包含 Ctrl、Alt、Meta，或使用 F1-F12。"));
      return;
    }
    const conflict = shortcutConflict(shortcut, commandId, props.shortcutMap);
    if (conflict) {
      setShortcutError(`${shortcut} ${t("已用于")}“${commandLabels.get(conflict) ?? conflict}”`);
      return;
    }
    props.onShortcutChange(commandId, [shortcut]);
    setRecordingId(null);
    setShortcutError("");
  }

  return (
    <div
      className="app-settings-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
      role="presentation"
    >
      <section aria-label={t("应用设置")} aria-modal="true" className="app-settings-dialog" role="dialog">
        <header className="app-settings-header">
          <div>
            <span>{t("个人知识库 Agent")}</span>
            <h2>{t("应用设置")}</h2>
          </div>
          <button aria-label={t("关闭设置")} onClick={props.onClose} title={t("关闭设置")} type="button">
            <X size={16} />
          </button>
        </header>

        <nav aria-label={t("设置分类")} className="app-settings-nav">
          {SECTION_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={props.activeSection === item.id ? "active" : ""}
                key={item.id}
                onClick={() => props.onSectionChange(item.id)}
                type="button"
              >
                <Icon size={15} />
                <span>{t(item.label)}</span>
              </button>
            );
          })}
        </nav>

        <main className="app-settings-content">
          {props.activeSection === "general" ? (
            <SettingsSection
              description={t("管理当前知识库、工作区布局和常用入口。")}
              title={t("常规")}
            >
              <SettingRow description={runtime(props.sourceName)} label={t("当前知识库")}>
                <button onClick={props.onOpenStorage} type="button">{t("管理存储空间")}</button>
              </SettingRow>
              <SettingRow description={t("保存侧栏宽度、显示状态和当前主视图。")} label={t("工作区布局")}>
                <button onClick={props.onOpenLayouts} type="button">{t("管理布局")}</button>
              </SettingRow>
              <SettingRow description={t("查看并恢复三十天内删除的本地文档。")} label={t("回收站")}>
                <button onClick={props.onOpenTrash} type="button">{t("打开回收站")}</button>
              </SettingRow>
            </SettingsSection>
          ) : null}

          {props.activeSection === "appearance" ? (
            <SettingsSection
              description={t("统一控制 App 和网页端的视觉主题与界面语言。")}
              title={t("外观与语言")}
            >
              <SettingRow description={t("主题选择会保存在当前设备。")} label={t("界面主题")}>
                <div className="settings-segmented">
                  <button
                    aria-pressed={props.appTheme === "light"}
                    className={props.appTheme === "light" ? "active" : ""}
                    onClick={() => props.onThemeChange("light")}
                    type="button"
                  >
                    <Sun size={14} />{t("浅色")}
                  </button>
                  <button
                    aria-pressed={props.appTheme === "dark"}
                    className={props.appTheme === "dark" ? "active" : ""}
                    onClick={() => props.onThemeChange("dark")}
                    type="button"
                  >
                    <Moon size={14} />{t("深色")}
                  </button>
                </div>
              </SettingRow>
              <SettingRow description={t("一个界面内切换中文或英文。")} label={t("界面语言")}>
                <div className="settings-segmented">
                  <button
                    aria-pressed={props.locale === "zh-CN"}
                    className={props.locale === "zh-CN" ? "active" : ""}
                    onClick={() => props.onLocaleChange("zh-CN")}
                    type="button"
                  >
                    <Languages size={14} />中文
                  </button>
                  <button
                    aria-pressed={props.locale === "en"}
                    className={props.locale === "en" ? "active" : ""}
                    onClick={() => props.onLocaleChange("en")}
                    type="button"
                  >
                    EN
                  </button>
                </div>
              </SettingRow>
            </SettingsSection>
          ) : null}

          {props.activeSection === "notes" ? (
            <SettingsSection
              description={t("配置模板、日记、格式转换和文件工作流。")}
              title={t("笔记与文件")}
            >
              <SettingRow description={t("设置模板文件夹、日记目录、日期格式和日记模板")} label={t("模板与日记")}>
                <button onClick={props.onOpenNoteWorkflow} type="button">{t("打开设置")}</button>
              </SettingRow>
              <SettingRow description={t("批量转换外部 Markdown 与旧属性格式。")} label={t("格式转换")}>
                <button onClick={props.onOpenFormatConverter} type="button">{t("打开转换器")}</button>
              </SettingRow>
              <SettingRow description={t("打开、创建知识库或读取硬盘目录结构。")} label={t("本地存储")}>
                <button onClick={props.onOpenStorage} type="button">{t("管理存储空间")}</button>
              </SettingRow>
            </SettingsSection>
          ) : null}

          {props.activeSection === "graph" ? (
            <SettingsSection
              description={t("控制文件关系图谱的筛选、文字和空间尺度。")}
              title={t("图谱与画布")}
            >
              <SettingRow description={t("按节点标题或路径筛选文件关系图谱。")} label={t("图谱筛选")}>
                <input
                  aria-label={t("筛选图谱节点")}
                  onChange={(event) => props.onGraphFilterChange(event.target.value)}
                  placeholder={t("节点标题或路径")}
                  value={props.graphFilter}
                />
              </SettingRow>
              <SettingRow description={t("缩小时仍可关闭文字，减少高密度遮挡。")} label={t("显示标签")}>
                <Toggle checked={props.graphShowLabels} onChange={props.onGraphShowLabelsChange} />
              </SettingRow>
              <SettingRow description={t("包括当前没有关系线的孤立文档。")} label={t("显示孤立节点")}>
                <Toggle checked={props.graphShowRelated} onChange={props.onGraphShowRelatedChange} />
              </SettingRow>
              <SettingRow description={t("调节关系图谱节点之间的整体距离。")} label={t("关系半径")}>
                <input
                  aria-label={t("图谱关系半径")}
                  max="1.35"
                  min="0.7"
                  onChange={(event) => props.onGraphRadiusChange(Number(event.target.value))}
                  step="0.05"
                  type="range"
                  value={props.graphRadius}
                />
              </SettingRow>
            </SettingsSection>
          ) : null}

          {props.activeSection === "agent" ? (
            <SettingsSection
              description={t("统一配置模型、笔记 Agent 模式和本机 API 连接。")}
              title={t("智能体")}
            >
              <SettingRow description={t("选择当前 Agent 调用的模型。")} label={t("模型")}>
                <select
                  disabled={props.modelOptions.length === 0}
                  onChange={(event) => props.onModelChange(event.target.value)}
                  value={props.selectedModel}
                >
                  {props.modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </SettingRow>
              <SettingRow
                description={props.agentModeOptions.find((option) => option.value === props.selectedAgentMode)?.description}
                label={t("智能体模式")}
              >
                <select
                  disabled={props.agentModeOptions.length === 0}
                  onChange={(event) => props.onAgentModeChange(event.target.value)}
                  value={props.selectedAgentMode}
                >
                  {props.agentModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </SettingRow>
              {props.modelProvider === "codex" ? (
                <SettingRow description={props.modelConnectionDescription} label={t("模型连接")}>
                  <div className={`settings-inline-status ${props.modelConfigured ? "valid" : "invalid"}`}>
                    <span />
                    {props.modelConfigured ? t("Codex 已连接") : t("Codex 未连接")}
                  </div>
                </SettingRow>
              ) : (
                <>
                  <SettingRow
                    description={t(props.modelConfigured ? "本机密钥已保存" : "未配置密钥")}
                    label={t("模型连接")}
                  >
                    <div className="settings-button-row">
                      <button disabled={!props.canConfigureModel || props.modelCredentialBusy} onClick={props.onRequestApiKey} type="button">
                        {t(props.modelConfigured ? "轮换密钥" : "配置")}
                      </button>
                      <button disabled={!props.modelConfigured || props.modelCredentialBusy} onClick={props.onValidateApiKey} type="button">
                        {t("检查")}
                      </button>
                      <button
                        className="danger"
                        disabled={!props.modelConfigured || props.modelCredentialBusy}
                        onClick={props.onDeleteApiKey}
                        type="button"
                      >
                        {t("删除")}
                      </button>
                    </div>
                  </SettingRow>
                  <div className={`settings-inline-status ${props.modelCredentialStatus}`}>
                    <span />
                    {t(
                      props.modelCredentialStatus === "valid"
                        ? "有效性检查通过"
                        : props.modelCredentialStatus === "invalid"
                          ? "密钥已失效"
                          : "尚未检查有效性"
                    )}
                  </div>
                </>
              )}
            </SettingsSection>
          ) : null}

          {props.activeSection === "shortcuts" ? (
            <SettingsSection
              actions={<button onClick={props.onResetAllShortcuts} type="button"><RefreshCw size={13} />{t("全部恢复默认")}</button>}
              description={t("按键完成导航、编辑、视图切换和 Agent 操作。点击快捷键后直接按下新的组合键。")}
              title={t("快捷键")}
            >
              <label className="shortcut-search">
                <Search size={14} />
                <input
                  aria-label={t("筛选快捷键")}
                  onChange={(event) => setShortcutQuery(event.target.value)}
                  placeholder={t("搜索命令或快捷键")}
                  value={shortcutQuery}
                />
              </label>
              {shortcutError ? <div className="shortcut-error">{shortcutError}</div> : null}
              <div className="shortcut-list">
                {filteredShortcuts.map((command) => (
                  <article className="shortcut-row" key={command.id}>
                    <span className="shortcut-category">{t(CATEGORY_LABELS[command.category])}</span>
                    <div>
                      <strong>{command.label}</strong>
                      {command.detail ? <small>{command.detail}</small> : null}
                    </div>
                    <button
                      className={recordingId === command.id ? "shortcut-recorder recording" : "shortcut-recorder"}
                      onClick={() => {
                        setRecordingId(command.id);
                        setShortcutError("");
                      }}
                      onKeyDown={(event) => recordShortcut(event, command.id)}
                      ref={recordingId === command.id ? recordingButtonRef : undefined}
                      type="button"
                    >
                      {recordingId === command.id
                        ? t("请按新的快捷键…")
                        : command.shortcuts[0] ?? t("未设置")}
                    </button>
                    <button
                      aria-label={`${t("清除快捷键")} ${command.label}`}
                      className="shortcut-icon-button"
                      onClick={() => props.onShortcutChange(command.id, [])}
                      title={t("清除快捷键")}
                      type="button"
                    >
                      <X size={13} />
                    </button>
                    <button
                      aria-label={`${t("恢复默认快捷键")} ${command.label}`}
                      className="shortcut-icon-button"
                      onClick={() => props.onResetShortcut(command.id)}
                      title={t("恢复默认快捷键")}
                      type="button"
                    >
                      <RefreshCw size={13} />
                    </button>
                  </article>
                ))}
              </div>
            </SettingsSection>
          ) : null}

          {props.activeSection === "updates" ? (
            <SettingsSection
              description={t("查看版本、发布者、签名策略、更新说明和安全规则。")}
              title={t("更新与安全")}
            >
              <SettingRow description={t("打开桌面端更新管理，检查版本与更新说明。")} label={t("软件更新")}>
                <button onClick={props.onOpenUpdates} type="button">{t("检查更新")}</button>
              </SettingRow>
              <SettingRow description={t("本地删除内容保留三十天，之后按真实系统时间清理。")} label={t("回收站保留")}>
                <button onClick={props.onOpenTrash} type="button">{t("查看回收站")}</button>
              </SettingRow>
              <div className="settings-security-note">
                <ShieldCheck size={16} />
                <p>{t("API key 仅保存在本机安全存储中；知识库正文不会因为设置操作被上传。")}</p>
              </div>
            </SettingsSection>
          ) : null}
        </main>
      </section>
    </div>
  );
}

function SettingsSection({
  actions,
  children,
  description,
  title
}: {
  actions?: ReactNode;
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="app-settings-section">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {actions}
      </header>
      <div className="app-settings-rows">{children}</div>
    </section>
  );
}

function SettingRow({
  children,
  description,
  label
}: {
  children: ReactNode;
  description?: string;
  label: string;
}) {
  return (
    <div className="app-setting-row">
      <div>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </div>
      <div className="app-setting-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange(value: boolean): void }) {
  const { t } = useLocalization();
  return (
    <button
      aria-checked={checked}
      className={checked ? "settings-toggle active" : "settings-toggle"}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
      {t(checked ? "开启" : "关闭")}
    </button>
  );
}
