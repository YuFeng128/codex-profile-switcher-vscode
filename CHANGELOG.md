# Changelog

All notable changes to this project will be documented in this file.

## [1.0.4] - 2026-07-14

### Added
- Added a recommended "follow current route" provider option that resolves the target route from the current Codex configuration when switching profiles.

### Changed
- Saving a profile with a fixed route now warns that chat history may be split across providers and recommends following the current route.

## [1.0.3] - 2026-07-14

### Added
- Added a top banner in the sidebar webview for the AI community group: `1060173874`.
- Added QQ and WeChat community group images to the README.

### Changed
- Simplified section styling by removing the full-height left border and keeping title-level color markers only.
- Refreshed README install/build notes and release artifact references for `1.0.3`.

## [1.0.2] - 2026-07-13

### Added
- Added provider mode selection for builtin `openai` routing via `openai_base_url` versus custom `[model_providers.<id>]` routing.
- Added auth-mode detection using `codex login status`, including API key / ChatGPT / access token recognition.
- Added fallback detection for implicit builtin OpenAI setups where `config.toml` has no provider/base URL and `auth.json` contains official account tokens.
- Added automatic official snapshot backup so builtin OpenAI or `requires_openai_auth = true` setups can be restored with one click.

### Changed
- Switching profiles now writes top-level `service_tier` and can optionally keep the current authentication unchanged.
- The sidebar UI now exposes provider mode, provider id, auth strategy, and legacy `preferred_auth_method = "apikey"` compatibility.

## [1.0.1] - 2026-04-11

### Added
- Added a per-profile "fast response" toggle in the VS Code sidebar form.
- Added current-state detection for `service_tier = "fast"` from `~/.codex/config.toml`.
- Added profile badges and status display for fast response in the webview UI.

### Changed
- Switching a profile now updates `base_url`, `OPENAI_API_KEY`, and optionally `service_tier = "fast"`.
- Importing the current configuration now also imports the fast-response state.
- Bumped extension version from `1.0.0` to `1.0.1`.

### Fixed
- Fixed profile matching so the current active profile also considers fast-response state.
- Fixed packaging by removing the README SVG usage that blocked `vsce package`.

## [1.0.0] - 2026-04-02

### Added
- Initial stable release of the Codex profile switching extension.
- Added profile save, update, delete, switch, and backup support.
- Added API key show/hide support in the form.

## [0.0.1] - 2026-04-02

### Added
- Initial preview build.
