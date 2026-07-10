# Public Release Notes

## v0.1.1

This is the first public-ready desktop installer track.

### What users get

- Windows desktop App built with Tauri + React.
- Local folder selection and local Markdown knowledge-base reading.
- File/TUI view, relationship graph, tabs, note editor, draft changes, and Note Agent panel.
- DeepSeek model connection through the Tauri backend.
- User-supplied API key flow: the installer does not include any private key.

### What is deliberately not included

- Private project memory.
- Personal vault files.
- API keys, `.env` files, `secrets.json`, or user-local settings.
- Automatic cloud upload of a user's knowledge base.

### Release checklist

Before publishing a release:

1. Run typecheck, tests, web build, desktop build, and Tauri package build.
2. Scan current files and git history for key-like secrets.
3. Confirm the installer launches.
4. Upload the installer as a GitHub Release asset.
5. Keep the source repository public, but keep each user's API key and vault data local.
