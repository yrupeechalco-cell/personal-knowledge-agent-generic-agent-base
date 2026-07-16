# Changelog

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
