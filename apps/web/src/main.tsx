import React from "react";
import ReactDOM from "react-dom/client";
import { KnowledgeAgentWebApp } from "./KnowledgeAgentWebApp";
import "@knowledge-agent/workspace/styles.css";
import "./mobile.css";
import { ensureBrowserRandomUUID } from "./browserCompatibility";

ensureBrowserRandomUUID();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <KnowledgeAgentWebApp />
  </React.StrictMode>
);
