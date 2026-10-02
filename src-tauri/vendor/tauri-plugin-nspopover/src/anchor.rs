use objc2::{rc::Retained, sel, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSColor, NSPopover, NSPopoverDidCloseNotification, NSScreen, NSWindow,
    NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::{MainThreadMarker, NSNotificationCenter, NSPoint, NSRect, NSSize};

/// A transparent anchor for a hidden or clipped menu-bar button. AppKit refuses
/// to show an NSPopover relative to a view with an empty visible rectangle.
pub fn prepare(
    window: &mut Option<Retained<NSWindow>>,
    popover: &NSPopover,
) -> Option<(Retained<NSWindow>, NSRect)> {
    let mtm = MainThreadMarker::new()?;
    let screen = NSScreen::mainScreen(mtm)?;
    let frame = screen.visibleFrame();
    let rect = NSRect::new(
        NSPoint::new(
            frame.origin.x + frame.size.width - 24.0,
            frame.origin.y + frame.size.height - 1.0,
        ),
        NSSize::new(1.0, 1.0),
    );

    let anchor = window.get_or_insert_with(|| {
        let anchor = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                rect,
                NSWindowStyleMask::Borderless,
                NSBackingStoreType::Buffered,
                true,
            )
        };
        unsafe {
            anchor.setReleasedWhenClosed(false);
        }
        anchor.setOpaque(false);
        anchor.setBackgroundColor(Some(&NSColor::clearColor()));
        anchor.setHasShadow(false);
        anchor.setIgnoresMouseEvents(true);
        anchor.setExcludedFromWindowsMenu(true);
        anchor.setLevel(3);
        anchor.setCollectionBehavior(
            NSWindowCollectionBehavior::MoveToActiveSpace
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        // Outside clicks close a transient popover without calling our hide
        // command. Hide its anchor too; selector observers are weak on macOS 12+.
        unsafe {
            NSNotificationCenter::defaultCenter().addObserver_selector_name_object(
                &anchor,
                sel!(orderOut:),
                Some(NSPopoverDidCloseNotification),
                Some(popover),
            );
        }
        anchor
    });
    Some((anchor.clone(), rect))
}
