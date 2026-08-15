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
