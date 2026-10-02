use std::sync::Mutex;

use tauri::{menu::Menu, tray::TrayIcon, Manager, Wry};

#[derive(Default)]
pub struct TrayMenuState(Mutex<Option<Menu<Wry>>>);

pub fn set(tray: &TrayIcon, menu: Menu<Wry>) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        // macOS 27 swallows left clicks while NSStatusItem.menu is attached.
        // Keep the menu alive here and attach it only during right-click tracking.
        // https://github.com/tauri-apps/tray-icon/pull/365
        let state = tray.app_handle().state::<TrayMenuState>();
        *state.0.lock().unwrap() = Some(menu);
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    tray.set_menu(Some(menu))
}

#[cfg(target_os = "macos")]
pub fn show(tray: &TrayIcon) -> Result<(), String> {
    use objc2_foundation::MainThreadMarker;

    // Menu tracking runs a nested event loop. Release the mutex before entering
    // it so a shortcut change can replace the menu without deadlocking.
    let menu = tray
        .app_handle()
        .state::<TrayMenuState>()
        .0
        .lock()
        .unwrap()
        .clone();
    let Some(menu) = menu else {
        return Ok(());
    };

    let tray_for_menu = tray.clone();
    tray.with_inner_tray_icon(move |inner| {
        let mtm = MainThreadMarker::new().ok_or("tray menu must run on main thread")?;
        let status = inner
            .ns_status_item()
            .ok_or("tray status item is unavailable")?;
        let button = status
            .button(mtm)
            .ok_or("tray status bar button is unavailable")?;
        tray_for_menu
            .set_menu(Some(menu))
            .map_err(|error| error.to_string())?;
        unsafe {
            button.performClick(None);
            status.setMenu(None);
        }
        Ok(())
    })
    .map_err(|error| error.to_string())?
}
