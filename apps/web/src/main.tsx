import React from "react";
import ReactDOM from "react-dom/client";
import { KnowledgeAgentWebApp } from "./KnowledgeAgentWebApp";
import "@knowledge-agent/workspace/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <KnowledgeAgentWebApp />
  </React.StrictMode>
);
