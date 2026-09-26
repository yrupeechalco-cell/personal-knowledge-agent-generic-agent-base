import React from "react";
import ReactDOM from "react-dom/client";
import { KnowledgeWorkspace } from "@knowledge-agent/workspace";
import { LanguageProvider } from "@knowledge-agent/ui";
import { createDesktopWorkspaceAdapter } from "./desktopWorkspaceAdapter";
import { DesktopUpdateNotifier } from "./DesktopUpdateNotifier";
import { MobileSyncPanel } from "./MobileSyncPanel";
import "@knowledge-agent/workspace/styles.css";
import "./desktop-update.css";

const adapter = createDesktopWorkspaceAdapter();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LanguageProvider>
      <KnowledgeWorkspace adapter={adapter} />
      <DesktopUpdateNotifier />
      <MobileSyncPanel />
    </LanguageProvider>
  </React.StrictMode>
);
