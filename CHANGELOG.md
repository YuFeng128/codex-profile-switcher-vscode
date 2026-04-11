# Changelog

All notable changes to this project will be documented in this file.

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
