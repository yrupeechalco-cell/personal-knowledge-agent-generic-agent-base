import { isTauri } from "@tauri-apps/api/core";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { Download, RefreshCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { useLocalization } from "@knowledge-agent/ui";

type UpdateState =
  | { status: "idle" | "checking" }
  | { status: "available"; update: Update }
  | { status: "downloading"; update: Update; progress: number | null }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SNOOZE_MS = 6 * 60 * 60 * 1000;
let startupCheck: Promise<Update | null> | null = null;

function checkOnce() {
  startupCheck ??= check({ timeout: 15_000 });
  return startupCheck.finally(() => {
    window.setTimeout(() => {
      startupCheck = null;
    }, 1_000);
  });
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
  const snoozed = useRef<{ version: string; until: number } | null>(null);
  const downloaded = useRef(0);
  const total = useRef<number | null>(null);

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
          message: error instanceof Error ? error.message : t("暂时无法检查更新")
        });
      }
    }
  }, [t]);

  useEffect(() => {
    if (!isTauri()) return;
    const startupTimer = window.setTimeout(() => void runCheck(true), 2_000);
    const interval = window.setInterval(() => void runCheck(true), CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(interval);
    };
  }, [runCheck]);

  const install = useCallback(async (update: Update) => {
    setState({ status: "downloading", update, progress: 0 });
    try {
      await update.downloadAndInstall((event) => {
        const progress = progressFromEvent(event, downloaded, total);
        setState({ status: "downloading", update, progress });
      });
      setState({ status: "ready", version: update.version });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : t("更新安装失败，请稍后再试")
      });
    }
  }, [t]);

  if (state.status === "idle" || state.status === "checking") return null;

  const update = state.status === "available" || state.status === "downloading"
    ? state.update
    : null;
  const title = state.status === "ready"
    ? locale === "en" ? `v${state.version} installed` : `v${state.version} 已安装`
    : state.status === "error"
      ? t("更新检查未完成")
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
          <span className="desktop-update-kicker">Knowledge Agent Update</span>
          <h2 id="desktop-update-title">{title}</h2>
          {state.status === "available" && (
            <p>{update?.body?.trim() || t("包含最新功能、体验改进与问题修复。")}</p>
          )}
          {state.status === "downloading" && (
            <>
              <p>{state.progress === null ? t("正在下载安装包…") : locale === "en" ? `Downloading update ${state.progress}%` : `正在下载安装包 ${state.progress}%`}</p>
              <div className="desktop-update-progress" aria-label={t("更新下载进度")}>
                <span style={{ width: `${state.progress ?? 18}%` }} />
              </div>
            </>
          )}
          {state.status === "ready" && <p>{t("更新将在应用重新启动后完整生效。")}</p>}
          {state.status === "error" && <p>{state.message}</p>}
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
            <button className="desktop-update-primary" type="button" onClick={() => void runCheck(false)}>
              <RefreshCw size={16} />{t("重新检查")}
            </button>
          )}
          {state.status === "ready" && (
            <button className="desktop-update-primary" type="button" onClick={() => setState({ status: "idle" })}>
              {t("知道了")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
