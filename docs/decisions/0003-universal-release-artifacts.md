# ADR-0003: Publish one Universal macOS release archive

## Status

Accepted

## Date

2026-08-15

## Context

YC Todo is a macOS menu bar app whose native popover integration is macOS-only.
The public download must work on current Apple Silicon Macs and older Intel Macs
without asking users to choose the correct architecture. Local and CI builds also
need to produce the same artifact names so README links remain stable.

The repository currently has no Apple Developer signing identity or notarization
credentials. Its historical App Sandbox entitlement also cannot be used for the
default local ad-hoc build: enabling it prevents the WebKit child process from
loading the UI, and the stored read-only file entitlement does not match JSON
export behavior.

## Decision

- Build the native app with Tauri's `universal-apple-darwin` target, which merges
  `arm64` and `x86_64` into one application executable.
- Publish one stable archive, `YC-Todo-macOS-universal.zip`, plus its SHA-256
  checksum. The GitHub latest-release URL therefore stays valid across versions.
- Build the `.app` with `--no-sign`, then sign the finished bundle. The default is
  an ad-hoc signature with no sandbox entitlements. A release operator can provide
  `CODESIGN_IDENTITY` and, after an explicit entitlement review,
  `CODESIGN_ENTITLEMENTS`.
- Create an annotated `v<version>` tag from the verified release commit, then
  publish the already verified ZIP and checksum to the matching GitHub Release.
  CI automation can be added later when the repository credential has explicit
  workflow-management scope.
- Set the supported baseline to macOS 12.0. This keeps one practical baseline for
  both architectures and the app's modern WebView interface.

## Alternatives considered

### Separate Apple Silicon and Intel downloads

This produces smaller downloads but makes installation and support more complex.
YC Todo is small enough that one Universal archive is the better user experience.

### DMG as the primary artifact

The current Tauri DMG helper is not reliable in the local build environment.
A ZIP preserves the `.app` bundle, is easy to checksum, and matches the existing
Orbit and NoType release approach.

### Enable App Sandbox in the default release

Rejected for this release. The current entitlement set both breaks the signed
WebView process and conflicts with writable JSON export. App Store sandboxing
requires a separate, explicit entitlement and distribution decision.

## Consequences

- One release file supports Apple Silicon and Intel Macs.
- Public ad-hoc builds still require Control-click → Open because they are not
  Apple-notarized.
- A future Developer ID release can reuse the script but must supply signing and
  notarization credentials and pass the full release checklist.
- A future App Store build needs a separate sandbox entitlement review and `.pkg`
  packaging path.

## Sources

- Tauri CLI Universal target:
  https://v2.tauri.app/reference/cli/#build
- Tauri macOS App Bundle distribution:
  https://v2.tauri.app/distribute/macos-application-bundle/
- Tauri macOS signing and notarization:
  https://v2.tauri.app/distribute/sign/macos/
