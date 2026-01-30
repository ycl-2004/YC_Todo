// src-tauri/src/lib.rs

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{ActivationPolicy, Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_nspopover::{AppExt as _, ToPopoverOptions, WindowExt as _};

/// ✅ Open system file picker safely in menubar/popover mode
/// Returns: Some(path) or None
#[tauri::command]
async fn pick_audio(app: tauri::AppHandle) -> Result<Option<String>, String> {
  let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();

  let app_ui = app.clone();
  let _ = app.run_on_main_thread(move || {
    // Hide popover first so OpenPanel won't attach to popover
    if app_ui.is_popover_shown() {
      app_ui.hide_popover();
    }

    let app_after = app_ui.clone();
    app_ui
      .dialog()
      .file()
      .add_filter("Audio", &["mp3", "m4a", "wav", "aac"])
      .pick_file(move |path_opt| {
        let picked = path_opt.map(|p| p.to_string());

        // Restore menubar state (still on main thread)
        let app_restore = app_after.clone();
        let _ = app_after.run_on_main_thread(move || {
          #[cfg(target_os = "macos")]
          {
            let _ = app_restore.set_activation_policy(ActivationPolicy::Accessory);
          }
          app_restore.show_popover();
        });

        let _ = tx.send(picked);
      });
  });

  let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
    .await
    .map_err(|_| "dialog join error".to_string())?;

  Ok(picked)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_nspopover::init())
    .invoke_handler(tauri::generate_handler![pick_audio])
    .setup(|app| {
      // ✅ macOS: menubar app (no Dock)
      #[cfg(target_os = "macos")]
      {
        app.set_activation_policy(ActivationPolicy::Accessory);
      }

      // ✅ main window -> popover
      let window = app
        .get_webview_window("main")
        .expect("missing window label=main");

      window.to_popover(ToPopoverOptions {
        is_fullsize_content: true,
      });

      // tray (created by tauri.conf.json)
      let tray = app.tray_by_id("main").expect("missing trayIcon id=main");

      // ---------- Menu items ----------
      let version_str = format!("Version {}", env!("CARGO_PKG_VERSION"));
      let version_item =
        MenuItem::with_id(app, "version", version_str, false, None::<&str>)?;
      let quit_item =
        MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

      // Theme items (flat)
      let theme_system =
        MenuItem::with_id(app, "theme_system", "Theme: System", true, None::<&str>)?;
      let theme_light =
        MenuItem::with_id(app, "theme_light", "Theme: Light", true, None::<&str>)?;
      let theme_dark =
        MenuItem::with_id(app, "theme_dark", "Theme: Dark", true, None::<&str>)?;

      // Accent items (flat)
      let accent_pink =
        MenuItem::with_id(app, "accent_pink", "Accent: Pink", true, None::<&str>)?;
      let accent_purple =
        MenuItem::with_id(app, "accent_purple", "Accent: Purple", true, None::<&str>)?;
      let accent_blue =
        MenuItem::with_id(app, "accent_blue", "Accent: Blue", true, None::<&str>)?;
      let accent_gray =
        MenuItem::with_id(app, "accent_gray", "Accent: Gray", true, None::<&str>)?;

      // Build menu
      let menu = Menu::with_items(
        app,
        &[
          &version_item,
          &PredefinedMenuItem::separator(app)?,

          &theme_system,
          &theme_light,
          &theme_dark,

          &PredefinedMenuItem::separator(app)?,

          &accent_pink,
          &accent_purple,
          &accent_blue,
          &accent_gray,

          &PredefinedMenuItem::separator(app)?,
          &quit_item,
        ],
      )?;

      tray.set_menu(Some(menu))?;
      tray.set_show_menu_on_left_click(false)?;

      // ---------- Menu events ----------
      let app_handle_for_menu = app.handle().clone();
      tray.on_menu_event(move |_tray, event| {
        match event.id().as_ref() {
          "quit" => app_handle_for_menu.exit(0),

          "theme_system" => { let _ = app_handle_for_menu.emit("settings://theme", "system"); }
          "theme_light"  => { let _ = app_handle_for_menu.emit("settings://theme", "light"); }
          "theme_dark"   => { let _ = app_handle_for_menu.emit("settings://theme", "dark"); }

          "accent_pink"   => { let _ = app_handle_for_menu.emit("settings://accent", "#d4a5c1"); }
          "accent_purple" => { let _ = app_handle_for_menu.emit("settings://accent", "#8e44ad"); }
          "accent_blue"   => { let _ = app_handle_for_menu.emit("settings://accent", "#2d7ff9"); }
          "accent_gray"   => { let _ = app_handle_for_menu.emit("settings://accent", "#4b4b4b"); }

          _ => {}
        }
      });

      // ---------- Left click toggles popover ----------
      let handle = app.handle().clone();
      tray.on_tray_icon_event(move |_, event| {
        if let tauri::tray::TrayIconEvent::Click { button, button_state, .. } = event {
          if button == tauri::tray::MouseButton::Left
            && button_state == tauri::tray::MouseButtonState::Up
          {
            if !handle.is_popover_shown() {
              handle.show_popover();
            } else {
              handle.hide_popover();
            }
          }
        }
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}