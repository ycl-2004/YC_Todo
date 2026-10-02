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
- The release profile disables stripping for build-time dependencies to avoid
  Rust's `mis-aligned LINKEDIT string pool` proc-macro loading error on macOS 27
  ([upstream issue](https://github.com/rust-lang/rust/issues/157750)). Application
  release optimization is unchanged.
- Confirm `lipo -archs` reports both `arm64` and `x86_64` for
  `YC Todo.app/Contents/MacOS/yc-todo`.
- Confirm `codesign --verify --deep --strict` passes.
- Confirm the ZIP expands into one `YC Todo.app`, launches on macOS, and retains
  the `com.yichen.yc.todo` bundle identifier.
- Verify the SHA-256 file against the final ZIP.

## Product regression

- Confirm the native popover and its full-size content area are 386×546.
- On macOS 27, repeatedly close the startup popover and reopen it with the
  menu-bar icon. Verify right-click menus, submenu actions, menu cancellation,
  and reopening by left click after each. Repeat with the global shortcut and
  confirm keyboard/IME input still works. Check About and the app bundle version
  agree so an old `/Applications` copy is not mistaken for the build under test.
- With only the release copy running, hide its popover and double-click that
  same `.app` in Finder. Verify the popover opens again and no second process
  or menu-bar icon is created. Repeat while the popover is already visible.
- Repeat with the menu-bar icon hidden or clipped: the task popover should open
  near the screen's upper right. Cancel it or click outside, then reopen it; its
  transparent positioning window must hide with the popover.
- With a menu-bar manager such as Thaw, record its version and test with it both
  running and quit, keeping one YC Todo instance. Check the manager's active
  Visible/Hidden layout and actual icon visibility separately from saved layout
  preferences. Window reopening alone does not verify managed-icon recovery.
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
