# Changelog

## 0.2.2 - 2026-07-15

### Changed

- Removed the bundled 36-note demonstration vault from the shared workspace package and all App/Web startup paths.
- Replaced Demo fallback behavior with an explicit empty source containing zero notes and zero allowed files.
- Added a focused first-run screen that asks the user to open or create a Markdown folder without implying any bundled content.
- Rebuilt the public README around first-run privacy, real local-folder behavior, graph semantics, Agent permissions, recovery, and App/Web differences.
- Replaced public screenshots with the current interface. Complex graph screenshots use a browser-memory external fixture that is never included in production bundles.

### Fixed

- New desktop installations no longer load fallback documents when no vault is configured or settings cannot be read.
- Unsupported browsers remain empty and show a compatibility message instead of receiving fallback notes.
- Empty startup no longer reports that a knowledge base has already loaded or repeats the disconnected source label.
- API-key onboarding no longer opens before a real knowledge source is connected.

### Verification

- Added Web, shared-workspace, and Desktop adapter tests that require zero bundled notes at startup.
- Public build checks now include source scans for removed Demo loaders and production-bundle scans for synthetic note titles.

## 0.2.1 - 2026-07-15

### Improved

- Unified the Windows App and public Web workspace around one shared 36-note, 12-domain knowledge terrain demo.
- Refined the 3D knowledge terrain with wider angular separation, responsive camera fitting, ink-wash nodes, clearer hover focus, and softer node boundaries.
- Added Cloudflare Pages security headers, immutable asset caching, and a guarded one-command deployment path for the canonical public site.
- Added Web/App release version parity checks so the two product surfaces cannot silently ship different versions.

### Fixed

- Restored desktop settings and model-secret loading when Windows writes UTF-8 JSON with a byte-order mark.
- Removed the stale three-note desktop fallback and the mismatched Web-only demo that caused App/Web graph drift.
- Locked the public demo baseline to 36 notes, 12 domains, 36 cross-domain relations, and zero excluded synthetic files.
- Added a post-publish UTF-8 manifest check and stable installer URL so signed in-app updates are verified before a release is considered complete.

### Privacy

- Cloud deployments fail before upload if the generated Web bundle contains an API key, private key marker, Windows user path, or the private F-drive demo path.
- Local visual artifacts, OMX state, vault content, API keys, and updater signing material remain excluded from source control.

## 0.2.0 - 2026-07-14

### Added

- Knowledge terrain experiment: a semantic 3D overview plus rooted role maps for questions, evidence, decisions, outputs, and supporting notes.
- Independent numbered Agent conversations with left-click switching and right-click deletion.
- Signed Windows in-app updates backed by GitHub Releases, including release notes, download progress, six-hour snooze, and automatic periodic checks.
- One-command Windows release tooling with version synchronization, signed NSIS packaging, GitHub Release upload, and `latest.json` generation.

### Preserved

- The original whole-vault file relationship graph remains available as a separate view.
- Local vault contents, DeepSeek API keys, updater private keys, and local project memory are excluded from public releases and source control.

### Upgrade note

Versions before `0.2.0` did not include the updater and must install `0.2.0` manually once. Later releases can be discovered and installed from inside the App.
