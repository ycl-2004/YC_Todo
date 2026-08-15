# Release checklist

## Version and source

- Confirm `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`, and the local `yc-todo` entry in `Cargo.lock` use the
  same version.
- Confirm the tag is exactly `v<version>` and does not already exist locally or
  on `origin`.
- Run `npm ci` and `npm run verify` from a clean checkout.
- Review the diff for local tasks, credentials, `.env` files, signing files,
  generated output, and unrelated changes before committing.
- Review README, release notes, changelog, and privacy claims against the tagged
  build.

## Universal artifact

- Install both Rust targets:
  `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.
- Run `npm run release:macos`.
- Confirm `lipo -archs` reports both `arm64` and `x86_64` for
  `YC Todo.app/Contents/MacOS/yc-todo`.
- Confirm `codesign --verify --deep --strict` passes.
- Confirm the ZIP expands into one `YC Todo.app`, launches on macOS, and retains
  the `com.yichen.yc.todo` bundle identifier.
- Verify the SHA-256 file against the final ZIP.

## Product regression

- Confirm the native popover and its full-size content area are 386×546.
- Validate task/note creation, progressive actions, long-title preview, focus
  timing, Free/Strict mode, global shortcuts, tray/popover behavior, custom
  sound selection, JSON import/export, Completed Undo, light/dark appearance,
  and keyboard navigation in the release build.
- Confirm existing tasks and settings survive upgrading from the previous
  installed version.
- Confirm all public screenshots use neutral demo data and match the shipping UI.

## GitHub Release

- Push the release commit before the tag.
- Push the annotated `v<version>` tag after the release commit is on `main`.
- Create the matching GitHub Release from that tag and upload the locally
  verified ZIP and checksum without rebuilding or renaming them.
- Confirm the GitHub Release is not a draft and contains exactly:
  `YC-Todo-macOS-universal.zip` and its `.sha256` file.
- Download the GitHub-hosted ZIP, verify its checksum, and perform a clean
  `/Applications` install before marking the release complete.
- Confirm the README latest-download URL resolves to the new archive.

## Signing and App Store boundaries

The default GitHub build is ad-hoc signed and not notarized. It requires
Control-click → Open. A normal public Developer ID distribution additionally
requires an installed `Developer ID Application` identity and Apple notarization
credentials; Tauri documents both at
https://v2.tauri.app/distribute/sign/macos/.

Do not pass the historical `src-tauri/entitlements.plist` to a public signing
identity without a separate review. It enables App Sandbox, prevents the current
WebKit child process from loading in local signed testing, and grants only
user-selected read access even though JSON export writes a file. Apple documents
the writable entitlement at
https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.files.user-selected.read-write.

App Store submission is a separate path: review sandbox permissions, sign the
`.app` and `.pkg` with the appropriate Apple identities, prepare App Store
screenshots/privacy answers, notarize or upload, and repeat the full regression
check. Do not treat the GitHub ZIP as an App Store artifact.
