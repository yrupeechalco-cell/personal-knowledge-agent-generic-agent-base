# Agent Install And Privacy Notes

This file is safe to publish. It documents the public installer flow and the local-only secret boundary.

## What is bundled

The Windows installer bundles the desktop app, the GenericAgent-inspired note agent kernel, the note tools, and the DeepSeek connection port.

The installer does not bundle any user's API key.

After installation, each user enters their own DeepSeek API key in the right-side Note Agent settings window. The key is saved only on that user's machine.

## Local key storage

Desktop app secrets are stored outside the repository under the app config directory:

```text
%APPDATA%\com.personal-knowledge-agent.desktop\secrets.json
```

Normal app settings are stored next to it:

```text
%APPDATA%\com.personal-knowledge-agent.desktop\settings.json
```

The repository must never contain `secrets.json`, `.env`, API keys, vault secrets, private user notes, or local-only project memory.

## DeepSeek connection

The desktop app calls DeepSeek through a Tauri backend command instead of making the request directly from the webview.

This keeps the API key out of frontend code and avoids browser-side CORS/runtime problems.

Default model:

```text
deepseek-v4-pro
```

Each user must provide their own API key. Do not place a real key in source files, examples, screenshots, issues, or release notes.

The app sends the current note, nearby vault context, and the user prompt to the model. File writes are still handled by the app's draft/diff workflow; the model is not given unrestricted system control.

## Release packaging

Build the installer with:

```bash
npm run tauri:build
```

Current Windows installer output:

```text
apps/desktop/src-tauri/target/release/bundle/nsis/个人知识库 Agent_0.1.1_x64-setup.exe
```

Recommended GitHub upload path:

1. Commit and push source code.
2. Upload the installer as a GitHub Release asset.
3. Do not commit the installer binary directly to `master`.

## Privacy release checklist

Before pushing or creating a release, run a secret scan from the repository root:

```powershell
rg -n "sk-[A-Za-z0-9]{16,}|gho_[A-Za-z0-9_]{20,}" . --glob '!node_modules/**' --glob '!apps/desktop/src-tauri/target/**' --glob '!.git/**'
```

Expected result: no repository files are returned.

Before making the repository public, also scan git history for committed secrets. If a secret or private planning file was ever committed, publish from a sanitized history rather than exposing the old private history.
