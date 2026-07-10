# App Ports And Entry Points

This project now has three different meanings of "opening the app". Keep them separate.

## Desktop App

Use this when the goal is the real Windows desktop app.

```bash
npm run tauri:dev
```

Tauri dev starts the Vite frontend on:

```text
http://127.0.0.1:5173/
```

That URL is only an internal dev server for the Tauri window. The actual user-facing surface is the native window titled:

```text
个人知识库 Agent
```

Release/package build:

```bash
npm run tauri:build
```

Current release outputs:

```text
apps/desktop/src-tauri/target/release/knowledge-agent-desktop.exe
apps/desktop/src-tauri/target/release/bundle/nsis/个人知识库 Agent_0.1.0_x64-setup.exe
```

The default Windows bundle target is NSIS. MSI/WiX was avoided because WiX `light.exe` failed in this local environment while the release exe and NSIS installer succeeded.

## Web Preview

Use this only for browser preview/debug.

```bash
npm run dev:web
```

Web preview URL:

```text
http://127.0.0.1:5174/
```

The Web App uses browser APIs such as `showDirectoryPicker()` and cannot silently access the real vault.

## Frontend-Only Desktop Preview

This is useful for UI-only iteration, but it is not the real desktop app.

```bash
npm run dev:desktop
```

URL:

```text
http://127.0.0.1:5173/
```

Do not confuse this browser URL with the Tauri app. If the user asks to "open the app", prefer `npm run tauri:dev` or the built release exe.

## Shared Workspace Adapter Port

`packages/workspace` owns the shared App shell.

Both Desktop and Web inject a `KnowledgeWorkspaceAdapter`:

- `loadInitialVault`
- `openVault`
- `loadDemoVault`
- `writeChanges`
- `getSourceLabel`

Desktop adapter:

```text
apps/desktop/src/desktopWorkspaceAdapter.ts
```

Web adapter:

```text
apps/web/src/KnowledgeAgentWebApp.tsx
```

## Tauri Command Ports

Desktop local capabilities are exposed through explicit Tauri commands:

- `select_vault_dir`
- `load_vault_notes`
- `save_note`
- `delete_note`
- `git_status`
- `git_commit`
- `git_push`
- `load_app_settings`
- `save_app_settings`
- `load_model_settings`
- `save_deepseek_api_key`
- `deepseek_chat_completion`

Command implementation:

```text
apps/desktop/src-tauri/src/lib.rs
```

Safety rule: UI edits must go through the draft/change panel first. Tauri commands are the local capability port, not a bypass around safety review.

## Agent Model Port

The desktop Note Agent uses a GenericAgent-inspired note kernel in `packages/agent`.

For desktop builds, model calls are routed through the Tauri command `deepseek_chat_completion` so API keys are not exposed to frontend code.

Users configure their own DeepSeek API key from the right-side Note Agent panel. The key is stored locally under:

```text
%APPDATA%\com.personal-knowledge-agent.desktop\secrets.json
```

The key must never be committed to GitHub or included in release source archives.

Current default model:

```text
deepseek-v4-pro
```
