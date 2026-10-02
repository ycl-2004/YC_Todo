# Changelog

All notable user-facing changes to YC Todo are documented here.

## [0.2.1] - 2026-10-01

### Fixed

- Restored menu-bar left-click popover opening on macOS 27 by attaching the
  context menu only during right-click presentation.
- Replaced the popover plugin's private tray layout casts with Tauri's public
  status-item access, removing the incompatible legacy tray dependency.
- Reopening the running app from Finder now activates it and reveals the popover.
- Added a screen-corner fallback when the menu-bar button has no visible anchor,
  preventing AppKit from silently ignoring the window request.

### Known limitations

- Thaw on macOS 27 may leave the icon invisible even when YC Todo is listed as
  Visible. Managed-icon recovery has not been verified; reopening the app still
  reveals its task window. See the [release notes](docs/releases/v0.2.1.md).

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

[0.2.1]: https://github.com/ycl-2004/YC_Todo/releases/tag/v0.2.1
[0.2.0]: https://github.com/ycl-2004/YC_Todo/releases/tag/v0.2.0
