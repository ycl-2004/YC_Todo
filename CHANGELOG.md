# Changelog

All notable user-facing changes to YC Todo are documented here.

## [0.2.0] - 2026-08-15

### Added

- Universal macOS release packaging for Apple Silicon and Intel Macs.
- Row-anchored previews for truncated task titles.
- Five-second Undo after clearing completed tasks.
- Explicit Free/Strict start-mode menu and improved keyboard/ARIA states.

### Changed

- Reworked task actions into a progressive rail: Start remains visible while
  Edit and Delete reveal on hover or keyboard focus.
- Reduced visual layering, spacing, and control weight throughout the popover.
- Updated Note, notification, search, statistics, and Completed controls with
  consistent iconography and interaction targets.

### Fixed

- Prevented task-row drag handling from intercepting buttons and checkboxes.
- Improved reduced-motion behavior and visible keyboard focus.
- Replaced the full-width hover overlay with a compact preview attached to its
  source task.

[0.2.0]: https://github.com/ycl-2004/YC_Todo/releases/tag/v0.2.0
