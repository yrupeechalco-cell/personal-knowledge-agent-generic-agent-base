# Changelog

## 0.2.6 - 2026-07-23

### Added

- Added a first-class knowledge canvas shared by the Windows App and Web workspace.
- Added editable text cards, tables, and live references to real Markdown notes.
- Added labeled relationship lines for related, supporting, contradicting, dependent, and reference relationships.
- Added multi-card topic groups, canvas pan/zoom, fit-to-content, card resizing, selection deletion, and undo/redo.
- Added durable canvas metadata at `.knowledge-agent/canvas.json` for writable local knowledge bases.
- Added graph camera controls for fit-to-content, reset, top-level folder clustering, and a live minimap.
- Added docked, floating, hidden, and focus modes for the Agent panel, including automatic idle collapse.
- Added a full Trash workspace with storage location, exact remaining retention time, read-only previews, and guarded restore actions.
- Added an updater trust panel showing the current version, publisher, signature policy, release notes, and automatic-check preference.

### Safety

- Canvas persistence never rewrites existing Markdown note bodies.
- Public GitHub repositories and read-only disk structure sources expose the canvas as read only.
- Browser persistence only begins after the user explicitly grants read/write access to a local folder.
- Pending canvas changes are flushed before switching storage sources so metadata cannot cross between knowledge bases.
- DeepSeek API keys are encrypted for the current Windows user with DPAPI instead of being stored as plaintext JSON.
- API-key rotation replaces the encrypted secret atomically; users can validate or delete the credential and inspect its latest validation time.
- Multi-note rename and move operations are validated first and committed as one native transaction, including Windows case-only renames.
- Deleted Markdown documents remain recoverable for exactly 30 days under the current vault's `.knowledge-agent-trash` directory.

### Improved

- Reduced dense-graph label collisions, kept nodes inside the usable viewport, and exposed hierarchy clustering without changing note contents.
- Localized remaining visible Agent, updater, graph, and credential-state strings across Chinese and English interfaces.
- Kept the main workspace usable while the Agent is hidden or floating, and restored the full-width center workspace in focus mode.

### Fixed

- Fixed credential rotation failing when an encrypted secret already existed on Windows.
- Fixed deleted credentials retaining stale rotation or validation timestamps in settings.
- Fixed persisted credential validation status being lost after an App restart.
- Fixed case-only Markdown renames being skipped on Windows.
- Fixed the offline model identity leaking as `offline:offline` in the Chinese interface.
- Fixed Agent auto-collapse reading its active prompt before that session state was initialized.

### Verification

- Added document-normalization, card-creation, browser persistence, native Rust round-trip, DPAPI, atomic replacement, case-only rename, Trash retention, and desktop-adapter tests.
- Verified all workspace type checks and unit tests, including 87 JavaScript/TypeScript tests and 22 native Rust tests.

## 0.2.5 - 2026-07-20

### Added

- Added editable per-note word clouds backed by the existing tag metadata, with five extraction granularity levels.
- Added local and model-assisted tag extraction that preserves user-confirmed tags and continues to work without a configured model.
- Added a tag-first 3D knowledge map with classification, connection, application, and source domains.
- Added tag detail cards with distribution, connection, application, and source-document evidence.

### Improved

- Separated the file-relationship graph from the new tag-system perspective instead of presenting folder structure as knowledge understanding.
- Added responsive label ranking and center-panel container rules so dense graphs remain readable in narrow desktop windows.
- Added wider three-axis layouts, smoother domain transitions, hover isolation, and evidence-backed relation highlighting.
- Kept each tag's base sphere size and each relation's base brightness stable across domains; domain-specific importance now appears through position and outer-rim emphasis.
- Restored the 3D-to-2D drill-down: clicking a tag sphere now opens its document root map, and returning reliably remounts the 3D canvas.
- Compressed the global sphere-size range and compensated perspective depth so the same tag keeps a comparable on-screen size across domains.

### Verification

- Added parser, tag editing, extraction, relationship-model, and word-cloud interaction tests.
- Verified the shared Web and Desktop builds against the same workspace implementation.

## 0.2.4 - 2026-07-16

### Fixed

- Fixed the Windows updater manifest workflow so multiple release installers can never be concatenated into one invalid download URL.
- Matched the selected installer to the manifest's actual signature instead of relying on ambiguous release asset ordering.
- Repaired the published `v0.2.3` manifest immediately, allowing existing clients to retry without waiting for this release.
- Separated update-check failures from update-installation failures and made installation errors retry the same signed update.
- Preserved string and object error details so the update window reports the real failure instead of a generic fallback.

### Verification

- Added release-manifest regression tests for exact URLs, whitespace rejection, and required signatures.
- Added a desktop updater regression test for installation failure, visible diagnostics, and successful retry.

## 0.2.3 - 2026-07-16

### Added

- Added a complete Chinese/English workspace language system shared by the Web App and Windows App, with browser-language detection, a persistent language switch, and URL overrides through `?lang=en` or `?lang=zh`.
- Added English product documentation and an English user guide while keeping the Chinese and English introductions clearly separated.
- Added localized graph terminology, Agent controls, storage panels, Trash details, safety summaries, live context labels, and desktop update dialogs.
- Added a read-only Web data source for public GitHub Markdown repositories using the repository default branch.
- Added repository URL parsing, GitHub API error handling, safety filtering, bounded concurrent Markdown loading, and browser memory limits.
- Added an optional one-click public example source while preserving the zero-content first-run contract.
- Added an optional repository-side static manifest so public demonstrations remain available when anonymous GitHub API quota is exhausted.
- Added YAML frontmatter tag indexing and explicit `domain` metadata support for authored macro-graph taxonomy.

### Safety

- Public GitHub sources cannot create, edit, rename, delete, apply Agent diffs, or write changes back to the repository.
- Sensitive paths continue to be excluded before Markdown content is fetched.
- Static manifests are validated for version, Markdown-only paths, duplicates, declared sizes, actual response sizes, file count, and total byte limits.
- Private repositories are not requested; authenticated GitHub write access remains outside the current release.

### Verification

- Added localization tests for language priority, browser defaults, static labels, and dynamic graph summaries.
- Added an English Agent interface regression test and a real-browser DOM check for the empty English workspace.

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
