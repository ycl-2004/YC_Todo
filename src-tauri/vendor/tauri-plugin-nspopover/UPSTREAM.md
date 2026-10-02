# Upstream provenance

- Upstream: https://github.com/freethinkel/tauri-nspopover-plugin
- Upstream license: see `LICENSE` in this directory
- Last comparison: 2026-08-15
- Compared upstream commit: `b571e0e665da7016d967bbf027b92951ac88f78e`

This vendored Rust crate contains YC Todo-specific changes. At the comparison
above, `src/lib.rs` and `src/popover.rs` differed from upstream by 49 insertions
and 17 deletions. The changes include access to the underlying macOS status item
and a floating window-level adjustment for the popover.

The exact historical base commit of the local patch is unknown. Before updating
the vendor copy:

1. Compare the local Rust source with the intended upstream revision.
2. Preserve the window-level and status-item behavior intentionally.
3. Run `cargo check --manifest-path src-tauri/Cargo.toml --locked`.
4. Launch the app and verify tray click, global shortcut, focus restoration,
   text input/IME layering, and popover hide/show behavior on macOS.
5. Confirm the configured 386 x 546 window produces a 386 x 546 full-size
   native popover without an extra AppKit content inset.

## YC Todo compatibility patch (2026-10-01)

Status-button access now uses Tauri 2.9's `with_inner_tray_icon` and the actual
tray icon's `ns_status_item` accessor. The earlier code reinterpreted Tauri's
private layout as an unrelated `tray-icon` 0.16 Git fork, despite Tauri using
0.21.3. That cast had no valid layout or ownership guarantee. The Git fork
dependency is removed; Tauri is constrained to the 2.9 patch series in both
manifests. The license, floating level, and full-size content are preserved.

YC Todo's native `src/tray_menu.rs` handles the separate macOS 27 click
regression described by [upstream tray-icon PR #365](https://github.com/tauri-apps/tray-icon/pull/365).
It retains the menu outside `NSStatusItem`, attaches it only while presenting a
right-click menu, and detaches it when tracking ends. This backports the fix
without replacing Tauri or vendoring another entire crate.

`src/anchor.rs` supplies a transparent positioning window when the status
button's visible rectangle is empty. AppKit otherwise ignores the show request.
The anchor is reused and hidden on explicit hide and NSPopoverDidCloseNotification;
normal icon anchoring, popover content, and keyboard/IME layering are preserved.
