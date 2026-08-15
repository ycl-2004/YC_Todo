# ADR-0002: Vendor the customized macOS nspopover plugin

## Status

Accepted

## Date

2026-08-15

## Context

YC Todo uses `tauri-plugin-nspopover` for its menu bar popover. The checked-in
Rust source is not identical to the current upstream project: it contains local
status-item access and window-level behavior needed by the app. A comparison
against upstream commit `b571e0e665da7016d967bbf027b92951ac88f78e` found 49
insertions and 17 deletions across the two Rust source files.

## Decision

Keep the customized Rust crate under
`src-tauri/vendor/tauri-plugin-nspopover/`. Retain the upstream license and
document its provenance. Exclude the upstream demo application, screenshots,
JavaScript build sources, and other files that are not required by the local
Cargo path dependency.

Keep `is_fullsize_content` enabled and configure the Tauri window as 386 x 546.
This lets the web content use the complete popover and matches the shipped
app's comfortable visual scale. A 360 x 520 full-size window makes the entire
surface smaller; a 386 x 546 non-full-size popover adds a 13-point AppKit inset
and leaves the content at the same cramped 360 x 520 size. Both regressions are
avoided without changing the product CSS.

## Alternatives considered

### Replace it with the current upstream Git dependency

Rejected because that would discard verified local behavior and could change
popover positioning or visibility.

### Use a Git submodule

Rejected because the local modifications would still require a maintained fork
and would make clean checkout/setup more fragile.

## Consequences

- Builds are self-contained with respect to the customized plugin source.
- The plugin remains a maintenance hotspot and contains unsafe macOS interop.
- Upstream updates must be compared and tested deliberately rather than applied
  as routine dependency updates.
- Popover-size verification is part of release QA because the content-size
  option can change the effective layout without changing any CSS.
