# Release checklist

## Before any public repository publication

- Choose and add the intended source-code license.
- Review README and privacy language against the shipping build.
- Confirm that no `.env`, credentials, signing files, or local task records are
  tracked.

## Before a signed macOS or App Store build

- Run `npm ci` and `npm run verify` from a clean checkout.
- Run `npm run tauri build` with the intended signing environment.
- Confirm both the native popover and its full-size content area are 386 x 546.
  A 360 x 520 full-size popover shrinks the whole interface; a 386 x 546
  non-full-size popover adds an unwanted 13-point inset and still crowds the
  content.
- Validate task creation, focus timing, global shortcuts, tray/popover behavior,
  custom sound selection, data import, and data export in the signed build.
- Resolve the sandbox entitlement decision for JSON export. The current source
  retains the historical user-selected read-only entitlement; Apple documents
  `com.apple.security.files.user-selected.read-write` for writing files chosen
  through Open or Save dialogs:
  https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.files.user-selected.read-write
- Confirm version parity across `package.json`, `src-tauri/tauri.conf.json`, and
  `src-tauri/Cargo.toml`.
- Confirm the App Store description, screenshots, privacy answers, signing,
  notarization, and bundle identifier.

An unsigned local bundle may launch for development but is not a distribution
artifact. `codesign --verify --deep --strict` is expected to pass only after the
intended Apple signing step.

Tauri's current distribution commands and signing overview are documented at
https://v2.tauri.app/distribute/.
