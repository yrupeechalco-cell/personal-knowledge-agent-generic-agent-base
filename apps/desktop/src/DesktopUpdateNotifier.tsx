import { isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { Download, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { useLocalization } from "@knowledge-agent/ui";

type UpdateState =
  | { status: "idle" | "checking" | "settings" }
  | { status: "available"; update: Update }
  | { status: "downloading"; update: Update; progress: number | null }
  | { status: "ready"; version: string }
  | { status: "error"; phase: "check" | "install"; message: string; update?: Update };

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SNOOZE_MS = 6 * 60 * 60 * 1000;
const AUTO_CHECK_STORAGE_KEY = "knowledge-agent:auto-update-check";
const OPEN_UPDATE_SETTINGS_EVENT = "knowledge-agent:open-update-settings";
const UPDATE_PUBLISHER = "yrupeechalco-cell";
let startupCheck: Promise<Update | null> | null = null;

function checkOnce() {
  startupCheck ??= check({ timeout: 15_000 });
  const currentCheck = startupCheck;
  return currentCheck.finally(() => {
    if (startupCheck === currentCheck) startupCheck = null;
  });
}

export function updateErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

function progressFromEvent(
  event: DownloadEvent,
  downloadedRef: MutableRefObject<number>,
  totalRef: MutableRefObject<number | null>
) {
  if (event.event === "Started") {
    downloadedRef.current = 0;
    totalRef.current = event.data.contentLength ?? null;
    return totalRef.current ? 0 : null;
  }
  if (event.event === "Progress") {
    downloadedRef.current += event.data.chunkLength;
    return totalRef.current
      ? Math.min(99, Math.round((downloadedRef.current / totalRef.current) * 100))
      : null;
  }
  return 100;
}

export function DesktopUpdateNotifier() {
  const { locale, t } = useLocalization();
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(AUTO_CHECK_STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const [currentVersion, setCurrentVersion] = useState("—");
  const snoozed = useRef<{ version: string; until: number } | null>(null);
  const downloaded = useRef(0);
  const total = useRef<number | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void getVersion().then(setCurrentVersion).catch(() => undefined);
    const openSettings = () => setState({ status: "settings" });
    window.addEventListener(OPEN_UPDATE_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_UPDATE_SETTINGS_EVENT, openSettings);
  }, []);

  const runCheck = useCallback(async (quiet = true) => {
    if (!isTauri()) return;
    if (!quiet) setState({ status: "checking" });
    try {
      const update = await checkOnce();
      const isSnoozed = update
        && snoozed.current?.version === update.version
        && snoozed.current.until > Date.now();
      if (update && !isSnoozed) {
        setState({ status: "available", update });
      } else if (!quiet) {
        setState({ status: "idle" });
      }
    } catch (error) {
      console.warn("Update check failed", error);
      if (!quiet) {
        setState({
          status: "error",
          phase: "check",
          message: updateErrorMessage(error, t("暂时无法检查更新"))
        });
      }
    }
  }, [t]);

  useEffect(() => {
    if (!isTauri() || !autoCheckEnabled) return;
    const startupTimer = window.setTimeout(() => void runCheck(true), 2_000);
    const interval = window.setInterval(() => void runCheck(true), CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(interval);
    };
  }, [autoCheckEnabled, runCheck]);

  const install = useCallback(async (update: Update) => {
    setState({ status: "downloading", update, progress: 0 });
    try {
      await update.downloadAndInstall((event) => {
        const progress = progressFromEvent(event, downloaded, total);
        setState({ status: "downloading", update, progress });
      });
      setState({ status: "ready", version: update.version });
    } catch (error) {
      console.warn("Update installation failed", error);
      setState({
        status: "error",
        phase: "install",
        message: updateErrorMessage(error, t("更新安装失败，请稍后再试")),
        update
      });
    }
  }, [t]);

  if (state.status === "idle" || state.status === "checking") return null;

  const update = state.status === "available" || state.status === "downloading"
    ? state.update
    : state.status === "error"
      ? state.update ?? null
    : null;
  const title = state.status === "ready"
    ? locale === "en" ? `v${state.version} installed` : `v${state.version} 已安装`
    : state.status === "error"
      ? state.phase === "install" ? t("更新安装失败") : t("更新检查失败")
      : state.status === "settings"
        ? t("更新与信任")
        : locale === "en" ? `Version v${update?.version} is available` : `发现新版本 v${update?.version}`;

  return (
    <div className="desktop-update-layer" role="presentation">
      <section className="desktop-update-card" role="dialog" aria-modal="true" aria-labelledby="desktop-update-title">
        <button
          className="desktop-update-close"
          type="button"
          aria-label={t("稍后提醒")}
          onClick={() => {
            if (update) snoozed.current = { version: update.version, until: Date.now() + SNOOZE_MS };
            setState({ status: "idle" });
          }}
        >
          <X size={16} />
        </button>
        <div className="desktop-update-icon"><Sparkles size={19} /></div>
        <div className="desktop-update-copy">
          <span className="desktop-update-kicker">{t("知识库智能体更新")}</span>
          <h2 id="desktop-update-title">{title}</h2>
          {state.status === "available" && (
            <>
              <p>{update?.body?.trim() || t("包含最新功能、体验改进与问题修复。")}</p>
              <UpdateTrustDetails
                currentVersion={currentVersion}
                targetVersion={update?.version ?? "—"}
                t={t}
                verified={false}
              />
            </>
          )}
          {state.status === "downloading" && (
            <>
              <p>{state.progress === null ? t("正在下载安装包…") : locale === "en" ? `Downloading update ${state.progress}%` : `正在下载安装包 ${state.progress}%`}</p>
              <div className="desktop-update-progress" aria-label={t("更新下载进度")}>
                <span style={{ width: `${state.progress ?? 18}%` }} />
              </div>
            </>
          )}
          {state.status === "ready" && (
            <>
              <p>{t("更新将在应用重新启动后完整生效。")}</p>
              <UpdateTrustDetails currentVersion={currentVersion} targetVersion={state.version} t={t} verified />
            </>
          )}
          {state.status === "error" && <p>{state.message}</p>}
          {state.status === "settings" && (
            <>
              <p>{t("控制启动时自动检查，并核对当前版本、发布者与安装前签名验证方式。")}</p>
              <UpdateTrustDetails currentVersion={currentVersion} targetVersion="—" t={t} verified={false} />
              <label className="desktop-update-toggle">
                <input
                  checked={autoCheckEnabled}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setAutoCheckEnabled(enabled);
                    try {
                      window.localStorage.setItem(AUTO_CHECK_STORAGE_KEY, String(enabled));
                    } catch {
                      // Preference remains active for this session.
                    }
                  }}
                  type="checkbox"
                />
                <span>{t("启动时及每 6 小时自动检查更新")}</span>
              </label>
            </>
          )}
        </div>
        <div className="desktop-update-actions">
          {state.status === "available" && (
            <>
              <button
                className="desktop-update-secondary"
                type="button"
                onClick={() => {
                  snoozed.current = { version: state.update.version, until: Date.now() + SNOOZE_MS };
                  setState({ status: "idle" });
                }}
              >
                {t("稍后")}
              </button>
              <button className="desktop-update-primary" type="button" onClick={() => void install(state.update)}>
                <Download size={16} />{t("立即更新")}
              </button>
            </>
          )}
          {state.status === "error" && (
            <button
              className="desktop-update-primary"
              type="button"
              onClick={() => state.phase === "install" && state.update
                ? void install(state.update)
                : void runCheck(false)}
            >
              <RefreshCw size={16} />{state.phase === "install" ? t("重试安装") : t("重新检查")}
            </button>
          )}
          {state.status === "ready" && (
            <button className="desktop-update-primary" type="button" onClick={() => setState({ status: "idle" })}>
              {t("知道了")}
            </button>
          )}
          {state.status === "settings" && (
            <>
              <button className="desktop-update-secondary" onClick={() => setState({ status: "idle" })} type="button">
                {t("关闭")}
              </button>
              <button className="desktop-update-primary" onClick={() => void runCheck(false)} type="button">
                <RefreshCw size={16} />{t("立即检查")}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function UpdateTrustDetails({
  currentVersion,
  targetVersion,
  t,
  verified
}: {
  currentVersion: string;
  targetVersion: string;
  t(source: string, values?: Record<string, string | number>): string;
  verified: boolean;
}) {
  return (
    <dl className="desktop-update-trust">
      <div><dt>{t("当前版本")}</dt><dd>v{currentVersion}</dd></div>
      <div><dt>{t("目标版本")}</dt><dd>{targetVersion === "—" ? "—" : `v${targetVersion}`}</dd></div>
      <div><dt>{t("发布者")}</dt><dd>{UPDATE_PUBLISHER}</dd></div>
      <div>
        <dt>{t("签名验证")}</dt>
        <dd>
          <ShieldCheck size={13} />
          {verified ? t("已通过 Tauri Ed25519 验证") : t("安装前强制执行 Tauri Ed25519 验证")}
        </dd>
      </div>
    </dl>
  );
}
