use objc2::{msg_send, rc::Retained, runtime::AnyObject};
use objc2_app_kit::{NSPopover, NSStatusBarButton, NSWindow};
use objc2_foundation::{MainThreadMarker, NSRectEdge};
use tauri::{
    plugin::{Builder, TauriPlugin},
    tray::TrayIcon,
    AppHandle, Manager, Runtime, State, WebviewWindow,
};

use std::sync::Mutex;

mod anchor;
mod popover;

use popover::PopoverController;

pub struct ToPopoverOptions {
    pub is_fullsize_content: bool,
}

pub trait WindowExt<R: Runtime> {
    fn to_popover(&self, options: ToPopoverOptions);
}
pub trait AppExt<R: Runtime> {
    fn is_popover_shown(&self) -> bool;
    fn show_popover(&self);
    fn hide_popover(&self);
    fn ns_popover(&self) -> Retained<NSPopover>;
    fn ns_statusbar_button(&self) -> Retained<NSStatusBarButton>;
}

pub use tauri::tray::TrayIconId;

pub trait StatusItemGetter {
    fn get_status_bar_button(&self) -> Retained<NSStatusBarButton>;
}

impl<R: Runtime> StatusItemGetter for TrayIcon<R> {
    fn get_status_bar_button(&self) -> Retained<NSStatusBarButton> {
        // Use Tauri's actual tray-icon type. Reinterpreting its private fields
        // as the old tray-icon fork has no valid Rust layout/ownership contract.
        // https://docs.rs/tauri/2.9.5/tauri/tray/struct.TrayIcon.html#method.with_inner_tray_icon
        self.with_inner_tray_icon(|tray| {
            let mtm = MainThreadMarker::new().expect("status item access must run on main thread");
            tray.ns_status_item()
                .and_then(|status| status.button(mtm))
                .map(SafeNSStatusBarButton)
        })
        .expect("failed to access tray icon")
        .expect("tray icon has no status bar button")
        .0
    }
}

impl<R: Runtime> WindowExt<R> for WebviewWindow<R> {
    fn to_popover(&self, options: ToPopoverOptions) {
        let tray = self.app_handle().tray_by_id("main").unwrap();

        let button = tray.get_status_bar_button();

        let window = self;
        let window = window.ns_window().unwrap();
        let ns_window = unsafe { (window.cast() as *mut NSWindow).as_ref().unwrap() };

        let _scale = self.scale_factor().unwrap();

        let popover_controller = PopoverController::new(ns_window);
        let _ = self.hide();

        let popover = SafeNSPopover(popover_controller.popover());
        if options.is_fullsize_content {
            unsafe { popover.0.setHasFullSizeContent(true) };
        }
        let button = SafeNSStatusBarButton(button);

        let state = self.app_handle().state() as State<'_, AppState>;
        *state.0.lock().unwrap() = Some(AppStateInner {
            popover,
            button,
            fallback_anchor: SafeNSWindow(None),
        });
    }
}

impl<R: Runtime> AppExt<R> for AppHandle<R> {
    fn is_popover_shown(&self) -> bool {
        let state: State<AppState> = self.state();

        if state.0.lock().unwrap().as_ref().is_none() {
            return false;
        }

        let state_guard = state.0.lock().unwrap();
        let inner = state_guard.as_ref().unwrap();
        let popover = &inner.popover.0;

        unsafe { popover.isShown() }
    }
    fn ns_popover(&self) -> Retained<NSPopover> {
        let state: State<AppState> = self.state();
        let guard = state.0.lock().unwrap();
        let inner = guard.as_ref().unwrap();
        let popover = &inner.popover.0;

        // Create a new reference to the same popover
        popover.clone()
    }
    fn ns_statusbar_button(&self) -> Retained<NSStatusBarButton> {
        let state: State<AppState> = self.state();
        let button = state.0.lock().unwrap().as_ref().unwrap().button.0.clone();

        button
    }

    fn show_popover(&self) {
        let state: State<AppState> = self.state();
        if state.0.lock().unwrap().as_ref().is_none() {
            return;
        }

        let popover = self.ns_popover();
        let button = self.ns_statusbar_button();
        let rect = button.bounds();

        #[cfg(debug_assertions)]
        eprintln!(
            "popover show: shown={}, anchor={:?}, visible_rect={:?}, anchor_visible={:?}, content_window_visible={:?}",
            popover.isShown(), rect, button.visibleRect(),
            button.window().map(|window| window.isVisible()),
            popover.contentViewController().and_then(|controller| controller.view().window()).map(|window| window.isVisible())
        );
        if unsafe { !popover.isShown() } {
            let visible = button.visibleRect();
            let button_visible = button.window().map(|window| window.isVisible()).unwrap_or(false)
                && visible.size.width > 0.0 && visible.size.height > 0.0;
            if button_visible {
                let anchor = state.0.lock().unwrap().as_ref().unwrap().fallback_anchor.0.clone();
                if let Some(anchor) = anchor {
                    anchor.orderOut(None);
                }
                popover.showRelativeToRect_ofView_preferredEdge(
                    rect,
                    button.as_ref(),
                    NSRectEdge::MaxY,
                );
            } else {
                let anchor = {
                    let mut guard = state.0.lock().unwrap();
                    anchor::prepare(&mut guard.as_mut().unwrap().fallback_anchor.0, &popover)
                };
                if let Some((anchor, rect)) = anchor {
                    anchor.setFrame_display(rect, false);
                    anchor.orderFrontRegardless();
                    if let Some(view) = anchor.contentView() {
                        popover.showRelativeToRect_ofView_preferredEdge(
                            view.bounds(), &view, NSRectEdge::MaxY,
                        );
                    }
                }
            }
            // Keep the popover above normal app/document windows,
            // while IME/keyboard candidate windows can still stay above it.
            set_popover_window_level(popover.as_ref());
            #[cfg(debug_assertions)]
            eprintln!("popover show result: shown={}, content_window_visible={:?}",
                popover.isShown(),
                popover.contentViewController().and_then(|controller| controller.view().window()).map(|window| window.isVisible())
            );
        }
    }
    fn hide_popover(&self) {
        let state: State<AppState> = self.state();

        if state.0.lock().unwrap().as_ref().is_none() {
            return;
        }
        let popover = self.ns_popover();

        if unsafe { popover.isShown() } {
            unsafe { popover.performClose(None) };
        }
        let anchor = state.0.lock().unwrap().as_ref().unwrap().fallback_anchor.0.clone();
        if let Some(anchor) = anchor {
            anchor.orderOut(None);
        }
    }
}

fn set_popover_window_level(popover: &NSPopover) {
    // NSFloatingWindowLevel:
    // above most regular document/browser windows, but typically below IME candidate panels.
    const FLOATING_WINDOW_LEVEL: i64 = 3;

    unsafe {
        let vc_ptr: *mut AnyObject = msg_send![popover, contentViewController];
        if vc_ptr.is_null() {
            return;
        }

        let view_ptr: *mut AnyObject = msg_send![vc_ptr, view];
        if view_ptr.is_null() {
            return;
        }

        let win_ptr: *mut AnyObject = msg_send![view_ptr, window];
        if win_ptr.is_null() {
            return;
        }

        let _: () = msg_send![win_ptr, setLevel: FLOATING_WINDOW_LEVEL];
    }
}

struct SafeNSPopover(Retained<NSPopover>);
struct SafeNSStatusBarButton(Retained<NSStatusBarButton>);
struct SafeNSWindow(Option<Retained<NSWindow>>);

unsafe impl Send for SafeNSPopover {}
unsafe impl Send for SafeNSStatusBarButton {}
unsafe impl Send for SafeNSWindow {}

#[tauri::command]
fn show_popover<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.show_popover();

    return Ok(());
}

#[tauri::command]
fn hide_popover<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.hide_popover();

    Ok(())
}

#[tauri::command]
fn is_popover_shown<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    return Ok(app.is_popover_shown());
}

struct AppStateInner {
    popover: SafeNSPopover,
    button: SafeNSStatusBarButton,
    fallback_anchor: SafeNSWindow,
}

struct AppState(Mutex<Option<AppStateInner>>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nspopover")
        .invoke_handler(tauri::generate_handler![
            show_popover,
            hide_popover,
            is_popover_shown
        ])
        .setup(|app, _| {
            app.manage(AppState(Mutex::new(None)));

            Ok(())
        })
        .build()
}
