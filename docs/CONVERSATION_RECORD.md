# Project Conversation Record

> Public, privacy-safe reconstruction of the product conversation.
>
> Read [Conversation Record Policy](CONVERSATION_RECORD_POLICY.md) for scope, redaction rules, and maintenance guidance.

## Product Starting Point

The project began with a practical question: how can an Obsidian-like personal knowledge base retain its clear document structure and graph thinking while gaining GitHub-backed sharing, version history, review, and eventual multi-person collaboration?

The resulting product is not intended to clone Obsidian or replace ordinary Markdown. It is a local-first knowledge workspace that uses Markdown files as the source of truth and treats GitHub as a collaboration substrate rather than as the reading interface.

## Durable Product Decisions

- Build real software, not only a marketing site or static documentation page.
- Use a desktop-first architecture: Tauri, React, and TypeScript, with reusable packages for a future Web surface.
- Preserve Obsidian-compatible Markdown, wikilinks, tags, frontmatter, backlinks, attachments, and folder structure.
- Keep the main application layout focused: file structure on the left, notes or graph in the center, and a note-specific Agent on the right.
- Keep local files under user ownership. The application must not silently upload a vault.
- Use GitHub later for commits, branches, pull requests, history, and sharing. Real-time multi-user editing is not a v0.1 promise.
- Treat credentials, private paths, password/account folders, `.env` files, and tool directories as sensitive by default.

## Architecture Conversation

The shared architecture was chosen early to avoid rewriting the product for each platform:

```text
apps/desktop     Native Windows shell, local filesystem, local settings, Git tools
apps/web         Browser preview and local-first experimentation
packages/core    Markdown parsing, link resolution, graph/index, safety rules
packages/agent   Note-specific GenericAgent-inspired loop and tool policy
packages/ui      File tree, editor, graph, mini graph, Agent console
packages/workspace  Shared application state and workspace behavior
```

The Agent is deliberately note-specific. It is inspired by GenericAgent-style tool loops and skills, but it is not given unrestricted shell or computer-control authority by default.

## Interface Direction

Visual references from Obsidian and Claudian guided the workbench rather than being copied literally. The important interaction language became:

- A real collapsible folder tree for containment and hierarchy.
- A whole-vault relationship graph for exploration, not a decorative current-note-only graph.
- A compact current-note graph for local orientation while reading or editing.
- A persistent top tab strip for note context.
- A right-side Agent console that remains usable while model work is running.
- Low-contrast scrolling, resizable columns, and a dark working surface intended for long sessions.

The file tree and graph were explicitly kept as different views of the same knowledge base. The tree answers where a document is stored; the graph answers what it connects to.

## Graph Interaction Iterations

The graph received sustained feedback and several corrections:

1. It changed from a current-note view to a whole-vault overview.
2. Nodes became draggable with a light force simulation, and the canvas gained pan and cursor-centered wheel zoom.
3. Hovering a node dims unrelated nodes and emphasizes direct relationships.
4. Pointer coordinate handling was corrected so horizontal and vertical movement match physical mouse movement at any window size.
5. Node movement was released from the original viewBox boundary so the graph behaves as a navigable canvas.
6. Labels now fade and disappear only when they become unreadable at small scale.
7. Ctrl-drag creates a batch-selection rectangle. Selection remains when interacting with a selected node, clears on a blank or unrelated click, and enables batch deletion through the graph trash target.

The recurring principle is that graph behavior must remain physically legible and useful in large vaults, not merely visually impressive in a small demo.

## Note Agent Conversation

The Agent evolved from a text-only assistant into a structured tool user:

- It can read and search notes, open notes, create notes, update notes, suggest links, generate MOCs, filter the workspace, and show the graph.
- It supports model settings, per-user API key entry, model mode selection, context-use reporting, and independent numbered sub-Agent conversations.
- Agent sessions keep their own messages, tool output, pending work, and history so one active request does not freeze the rest of the App.
- The message pane follows new conversation output automatically so the latest user and Agent messages remain visible.

The product does not embed user credentials in source code or release artifacts. A credential mentioned during private development was intentionally excluded from Git history and public documentation.

## Local Storage and Persistence

The central product requirement is that the knowledge base cannot be a one-session demo.

- A selected desktop vault is a real local folder, remembered by the App between launches.
- Safe Markdown creation and editing autosave to that folder after a short debounce.
- Reopening the App reloads the actual files from disk and rebuilds the index and graph.
- Empty startup and read-only structure modes have no writable folder, so persistent stress-graph generation is blocked instead of pretending data was saved.
- A separate read-only structure scan can enumerate folders and file names from a selected local location without opening file bodies or modifying source files.

The current connected vault path is intentionally not published here. It is local user configuration, represented in this record as `[LOCAL_PATH_REDACTED]`.

## Deletion and Recovery Policy

The conversations established two deletion paths with one recovery model:

- Manual deletion: the user sees one explicit confirmation. Confirming immediately moves the Markdown file to `.knowledge-agent-trash` inside the selected vault.
- Agent deletion: the Agent may move a file to the same trash when the current user message explicitly authorizes deletion; no redundant UI confirmation is required.
- Recovery: trash entries retain original path, deletion time, and a real 30-day expiry. The Agent can list the trash and restore an explicitly requested entry to its original path during the current request.
- Existing destination files block unsafe restoration overwrites.

This makes deletion reversible without treating a vague Agent suggestion as perpetual authority. Agent create/delete/restore authority is limited to the current user request and reset afterward.

## Verification Culture

The project conversation repeatedly required real verification rather than decorative controls. Important checks now include:

- Markdown parsing, graph/index, Agent, UI, and workspace tests.
- Type checking and production desktop builds.
- Rust tests for native filesystem operations.
- A persistence regression test that saves a nested note, reloads the vault, and verifies the same path and content.
- A read-only structure-scan test that verifies original file bytes are not read into generated note content or modified.
- Exact 30-day trash-retention tests.

## Current Boundary: Full Disk Workspace

The desktop application has native access to the selected Markdown vault, not a missing OS permission. It currently writes real Markdown files and can list arbitrary directory structures in a separate read-only mode.

Turning the full drive into a general file manager is technically possible but is a separate product mode. It needs distinct handling for non-Markdown files such as Word documents, images, archives, and executable files, plus safe move/delete/restore rules that do not reuse the note editor's assumptions. That work remains intentionally separate from the current knowledge-vault workflow.

## Ongoing Direction

The product continues toward a daily-use personal knowledge application with:

- Strong local ownership and safety.
- Clear structural and relational navigation.
- An Agent that can make concrete, reversible progress inside the workspace.
- GitHub collaboration and publishing capabilities added only after the local workflow is reliable.

This record should be updated when those durable decisions change.
