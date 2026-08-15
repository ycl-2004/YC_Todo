# YC Todo project instructions

## Stack

- React 18 with JavaScript and Vite 8
- Tauri 2 with Rust 2021 edition
- macOS menu bar application; the custom nspopover integration is macOS-only

## Commands

- Install: `npm ci`
- Develop: `npm run tauri dev`
- Verify all current checks: `npm run verify`
- Frontend build: `npm run build`
- Rust check: `cargo check --manifest-path src-tauri/Cargo.toml --locked`
- Bundle: `npm run tauri build`

## Conventions

- Keep the frontend at the repository root and native code in `src-tauri/`.
- Preserve user data compatibility, localStorage keys, shortcuts, and Tauri
  command names unless a task explicitly changes behavior.
- Keep package, Tauri, and Cargo versions synchronized through the bump scripts.
- Update README, privacy documentation, or an ADR when behavior, permissions,
  architecture, setup, or release requirements change.
- Do not commit generated `dist/`, `target/`, `gen/`, `.DS_Store`, or `.fable/`
  content.

## Boundaries

- Do not add runtime networking, analytics, telemetry, or remote data storage
  without an explicit product decision and privacy-document update.
- Do not modify `src-tauri/vendor/tauri-plugin-nspopover` as routine cleanup.
  Read its `UPSTREAM.md`, preserve its license, and verify popover behavior on
  macOS after any change.
- Do not change sandbox entitlements, signing, publishing, Git remotes, or
  GitHub state without explicit authorization.
- Do not select an open-source license on the owner's behalf.
