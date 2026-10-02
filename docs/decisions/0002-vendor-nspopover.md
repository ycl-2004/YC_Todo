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

## macOS 27 compatibility (2026-10-01)

macOS 27 stops forwarding left clicks to the tray icon's event view while an
`NSMenu` is attached to its `NSStatusItem`. YC Todo's startup show still works,
but later icon clicks cannot reach the popover toggle. This matches
[tray-icon issue #355](https://github.com/tauri-apps/tray-icon/issues/355) and
the [upstream fix in PR #365](https://github.com/tauri-apps/tray-icon/pull/365).

Keep the current Tauri 2.9 dependency series. Retain the tray menu in application
state, attach it only during right-click presentation, and detach it afterward.
Clone the menu and release its state mutex before menu tracking, because AppKit
runs a nested event loop that can change shortcut settings. Use the same menu
state for shortcut-label updates. Left clicks continue to toggle the popover.

The popover plugin now obtains the status button through Tauri's public
`with_inner_tray_icon` interface. Remove the old 0.16 Git fork and private-layout
casts, which are incompatible with the 0.21.3 type actually owned by Tauri.
Preserve the 386 x 546 content size, floating window level, command names,
shortcut persistence, and local user-data format.

On the test host, the status button also had an empty visible rectangle: its
window existed but had height zero. AppKit's documented
[`show(relativeTo:of:preferredEdge:)`](https://developer.apple.com/documentation/appkit/nspopover/show(relativeto:of:preferrededge:))
does nothing for an invisible anchor. Check the button's window and visible
rectangle before presenting. Use a lazily created, transparent 1 x 1 window
near the active screen's upper right as the fallback anchor. Reuse it, exclude
it from window navigation, and hide it both explicitly and on the popover's
did-close notification. Keep normal icon anchoring when the button is visible.

Follow-up diagnosis on the same host found Thaw 3.0.0-alpha.6 running. The user
reported that quitting Thaw restores normal YC Todo operation, while starting
Thaw makes the icon disappear. Thaw still enumerates the running YC Todo process,
and its saved section order places `com.yichen.yc.todo:Item-0` in Visible. Its
known-item cache also contains identifiers from earlier duplicate instances.
These observations implicate the Thaw/macOS layout interaction, but do not prove
which hiding or restoration path is responsible. In particular, the empty
anchor alone is not evidence that YC Todo caused the icon to disappear, and
cached duplicate identifiers are not proof that the current item is hidden.
The fallback keeps window reopening usable; it does not restore a managed icon.

[Thaw alpha.7 release notes](https://github.com/thaw-app/Thaw/releases/tag/3.0.0-alpha.7)
describe identity, placement, and reveal fixes, alongside remaining macOS 27
limitations. That release has not been tested with YC Todo here. Do not change
the tray identity or reset the user's layout without a reproduced app-side cause.

Handle macOS `RunEvent::Reopen` by activating the app and showing its existing
popover. Do not gate this on `has_visible_windows`, since the hidden host or
positioning window can be counted independently of the task popover.
