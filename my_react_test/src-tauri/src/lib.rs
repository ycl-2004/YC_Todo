// src-tauri/src/lib.rs

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{ActivationPolicy, Emitter, Manager, State};

use tauri_plugin_dialog::DialogExt;
use tauri_plugin_nspopover::{AppExt as _, ToPopoverOptions, WindowExt as _};

use tauri_plugin_global_shortcut::{
  Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState as ShortcutEventState,
};

struct AlarmState(Mutex<Option<Child>>);

#[derive(Debug, Clone, Serialize)]
struct StoredAudio {
  path: String,
  name: String,
}

#[cfg(target_os = "macos")]
use cocoa::appkit::{NSOpenPanel, NSModalResponse, NSSavePanel};
#[cfg(target_os = "macos")]
use cocoa::base::{id, nil, NO, YES};
#[cfg(target_os = "macos")]
use cocoa_foundation::foundation::{NSArray, NSString, NSURL};
#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};
#[cfg(target_os = "macos")]
fn activate_app_now() {
  use objc::class;

  unsafe {
    let nsapp: *mut objc::runtime::Object =
      msg_send![class!(NSApplication), sharedApplication];
    let _: () = msg_send![nsapp, activateIgnoringOtherApps: true];
  }
}

#[cfg(target_os = "macos")]
unsafe fn path_buf_to_nsurl(path: &std::path::Path) -> id {
  let path_str = path.to_string_lossy();
  let ns_path = NSString::alloc(nil).init_str(path_str.as_ref());
  NSURL::fileURLWithPath_(nil, ns_path)
}

#[cfg(target_os = "macos")]
unsafe fn nsurl_to_path_string(url: id) -> Option<String> {
  if url == nil {
    return None;
  }

  let ns_path: id = objc::msg_send![url, path];
  if ns_path == nil {
    return None;
  }

  let c_str = NSString::UTF8String(ns_path);
  if c_str.is_null() {
    return None;
  }

  Some(std::ffi::CStr::from_ptr(c_str).to_string_lossy().into_owned())
}

#[cfg(target_os = "macos")]
unsafe fn build_json_types_array() -> id {
  let ext = NSString::alloc(nil).init_str("json");
  NSArray::arrayWithObject(nil, ext)
}

/// -----------------------------
/// Shortcut state + persistence
/// -----------------------------
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ShortcutSpec {
  meta: bool,
  shift: bool,
  alt: bool,
  ctrl: bool,
  /// JS KeyboardEvent.code, e.g. "KeyJ", "KeyK", "Digit1"
  code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct ShortcutConfig {
  popover: ShortcutSpec,
  sound: ShortcutSpec,
  notif_mode: ShortcutSpec,
  prev_tag: ShortcutSpec,
  next_tag: ShortcutSpec,
  focus_create: ShortcutSpec,
  start_first: ShortcutSpec,
}

impl Default for ShortcutConfig {
  fn default() -> Self {
    Self {
      popover: ShortcutSpec {
        meta: true,
        shift: true,
        alt: false,
        ctrl: false,
        code: "KeyJ".to_string(),
      },
      sound: ShortcutSpec {
        meta: true,
        shift: true,
        alt: false,
        ctrl: false,
        code: "KeyI".to_string(),
      },
      notif_mode: ShortcutSpec { // ✅ NEW
        meta: true,
        shift: true,
        alt: false,
        ctrl: false,
        code: "KeyO".to_string(),
      },
      prev_tag: ShortcutSpec {
        meta: true,
        shift: true,
        alt: false,
        ctrl: false,
        code: "KeyK".to_string(),
      },
      next_tag: ShortcutSpec {
        meta: true,
        shift: true,
        alt: false,
        ctrl: false,
        code: "KeyL".to_string(),
      },
      focus_create: ShortcutSpec {
        meta: true,
        shift: true,
        alt: false,
        ctrl: false,
        code: "KeyU".to_string(),
      },
      start_first: ShortcutSpec {
        meta: true,
        shift: true,
        alt: false,
        ctrl: false,
        code: "Enter".to_string(),
      },
    }
  }
}

struct ShortcutConfigState(Mutex<ShortcutConfig>);


fn config_file_path(app: &tauri::AppHandle) -> Option<PathBuf> {
  let dir = app.path().app_config_dir().ok()?;
  let _ = fs::create_dir_all(&dir);
  Some(dir.join("yc_todo_shortcuts.json"))
}

fn load_shortcuts(app: &tauri::AppHandle) -> ShortcutConfig {
  let Some(p) = config_file_path(app) else {
    return ShortcutConfig::default();
  };

  if let Ok(s) = fs::read_to_string(&p) {
    if let Ok(cfg) = serde_json::from_str::<ShortcutConfig>(&s) {
      return cfg;
    }
  }
  ShortcutConfig::default()
}

fn save_shortcuts(app: &tauri::AppHandle, cfg: &ShortcutConfig) {
  let Some(p) = config_file_path(app) else { return; };
  if let Ok(s) = serde_json::to_string_pretty(cfg) {
    let _ = fs::write(p, s);
  }
}

fn stored_audio_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_local_data_dir()
    .map_err(|e| format!("resolve app local data dir failed: {}", e))?;

  fs::create_dir_all(&dir)
    .map_err(|e| format!("create app local data dir failed: {}", e))?;

  Ok(dir.join("alarm.mp3"))
}

fn path_to_string(path: PathBuf) -> String {
  path.to_string_lossy().into_owned()
}

fn copy_audio_to_app_storage(
  app: &tauri::AppHandle,
  source: PathBuf,
) -> Result<StoredAudio, String> {
  let ext = source
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_ascii_lowercase();

  if ext != "mp3" {
    return Err("Please choose an MP3 file.".to_string());
  }

  let name = source
    .file_name()
    .and_then(|n| n.to_str())
    .unwrap_or("alarm.mp3")
    .to_string();

  let dest = stored_audio_file_path(app)?;

  let same_file = match (fs::canonicalize(&source), fs::canonicalize(&dest)) {
    (Ok(src), Ok(dst)) => src == dst,
    _ => false,
  };

  if !same_file {
    let tmp = dest.with_extension("mp3.tmp");
    if tmp.exists() {
      let _ = fs::remove_file(&tmp);
    }

    fs::copy(&source, &tmp)
      .map_err(|e| format!("copy MP3 to app storage failed: {}", e))?;

    if dest.exists() {
      let _ = fs::remove_file(&dest);
    }

    fs::rename(&tmp, &dest)
      .map_err(|e| format!("save MP3 to app storage failed: {}", e))?;
  }

  Ok(StoredAudio {
    path: path_to_string(dest),
    name,
  })
}

fn to_modifiers(spec: &ShortcutSpec) -> Option<Modifiers> {
  let mut m = Modifiers::empty();
  if spec.meta { m |= Modifiers::META; }
  if spec.shift { m |= Modifiers::SHIFT; }
  if spec.alt { m |= Modifiers::ALT; }
  if spec.ctrl { m |= Modifiers::CONTROL; }

  if m.is_empty() {
    return None;
  }
  Some(m)
}

fn code_from_js(code: &str) -> Option<Code> {
  // 支持：KeyA..KeyZ / Digit0..Digit9 / Enter
  if let Some(ch) = code.strip_prefix("Key") {
    if ch.len() == 1 {
      let c = ch.chars().next().unwrap();
      return match c {
        'A' => Some(Code::KeyA),
        'B' => Some(Code::KeyB),
        'C' => Some(Code::KeyC),
        'D' => Some(Code::KeyD),
        'E' => Some(Code::KeyE),
        'F' => Some(Code::KeyF),
        'G' => Some(Code::KeyG),
        'H' => Some(Code::KeyH),
        'I' => Some(Code::KeyI),
        'J' => Some(Code::KeyJ),
        'K' => Some(Code::KeyK),
        'L' => Some(Code::KeyL),
        'M' => Some(Code::KeyM),
        'N' => Some(Code::KeyN),
        'O' => Some(Code::KeyO),
        'P' => Some(Code::KeyP),
        'Q' => Some(Code::KeyQ),
        'R' => Some(Code::KeyR),
        'S' => Some(Code::KeyS),
        'T' => Some(Code::KeyT),
        'U' => Some(Code::KeyU),
        'V' => Some(Code::KeyV),
        'W' => Some(Code::KeyW),
        'X' => Some(Code::KeyX),
        'Y' => Some(Code::KeyY),
        'Z' => Some(Code::KeyZ),
        _ => None,
      };
    }
  }

  if let Some(d) = code.strip_prefix("Digit") {
    if d.len() == 1 {
      return match d.chars().next().unwrap() {
        '0' => Some(Code::Digit0),
        '1' => Some(Code::Digit1),
        '2' => Some(Code::Digit2),
        '3' => Some(Code::Digit3),
        '4' => Some(Code::Digit4),
        '5' => Some(Code::Digit5),
        '6' => Some(Code::Digit6),
        '7' => Some(Code::Digit7),
        '8' => Some(Code::Digit8),
        '9' => Some(Code::Digit9),
        _ => None,
      };
    }
  }

  if code == "Enter" {
    return Some(Code::Enter);
  }

  None
}

fn spec_to_shortcut(spec: &ShortcutSpec) -> Result<Shortcut, String> {
  let mods = to_modifiers(spec).ok_or("shortcut must include at least one modifier")?;
  let code =
    code_from_js(&spec.code).ok_or("unsupported key code (supported: KeyA..KeyZ, Digit0..9, Enter)")?;
  Ok(Shortcut::new(Some(mods), code))
}

fn display_from_spec(spec: &ShortcutSpec) -> String {
  let mut s = String::new();
  if spec.ctrl { s.push('⌃'); }
  if spec.alt { s.push('⌥'); }
  if spec.shift { s.push('⇧'); }
  if spec.meta { s.push('⌘'); }

  let key = if let Some(k) = spec.code.strip_prefix("Key") {
    k.to_string()
  } else if let Some(k) = spec.code.strip_prefix("Digit") {
    k.to_string()
  } else {
    spec.code.clone()
  };

  s + &key
}

fn shortcut_spec_for_target<'a>(cfg: &'a ShortcutConfig, target: &str) -> Option<&'a ShortcutSpec> {
  match target {
    "popover" => Some(&cfg.popover),
    "sound" => Some(&cfg.sound),
    "notif_mode" => Some(&cfg.notif_mode),
    "prev_tag" => Some(&cfg.prev_tag),
    "next_tag" => Some(&cfg.next_tag),
    "focus_create" => Some(&cfg.focus_create),
    "start_first" => Some(&cfg.start_first),
    _ => None,
  }
}

fn shortcut_spec_for_target_mut<'a>(
  cfg: &'a mut ShortcutConfig,
  target: &str,
) -> Option<&'a mut ShortcutSpec> {
  match target {
    "popover" => Some(&mut cfg.popover),
    "sound" => Some(&mut cfg.sound),
    "notif_mode" => Some(&mut cfg.notif_mode),
    "prev_tag" => Some(&mut cfg.prev_tag),
    "next_tag" => Some(&mut cfg.next_tag),
    "focus_create" => Some(&mut cfg.focus_create),
    "start_first" => Some(&mut cfg.start_first),
    _ => None,
  }
}

fn all_shortcut_targets() -> [&'static str; 7] {
  [
    "popover",
    "sound",
    "notif_mode",
    "prev_tag",
    "next_tag",
    "focus_create",
    "start_first",
  ]
}

fn emit_shortcut_capture(app_handle: tauri::AppHandle, target: &'static str) {
  let outer = app_handle.clone();
  let inner = outer.clone();

  let _ = outer.run_on_main_thread(move || {
    if !inner.is_popover_shown() {
      inner.show_popover();
    }
  });

  tauri::async_runtime::spawn(async move {
    std::thread::sleep(std::time::Duration::from_millis(60));
    let _ = app_handle.emit(
      "ui://capture-shortcut",
      serde_json::json!({ "target": target }),
    );
  });
}

fn rebuild_tray_menu<R: tauri::Runtime>(
  app: &tauri::AppHandle<R>,
  cfg: &ShortcutConfig,
) -> Result<Menu<R>, tauri::Error> {
  let version_str = format!("Version {}", env!("CARGO_PKG_VERSION"));
  let version_item = MenuItem::with_id(app, "version", version_str, false, None::<&str>)?;
  let notif_mode_sound =
    MenuItem::with_id(app, "notif_mode_sound", "Sound", true, None::<&str>)?;
  let notif_mode_quiet =
    MenuItem::with_id(app, "notif_mode_quiet", "Quiet", true, None::<&str>)?;
  let notif_mode_menu = Submenu::with_items(
    app,
    "Notification Mode",
    true,
    &[&notif_mode_sound, &notif_mode_quiet],
  )?;

  let pop = display_from_spec(&cfg.popover);
  let snd = display_from_spec(&cfg.sound);

  // ✅ 新增：设置快捷键菜单项（显示当前值）
  let set_popover = MenuItem::with_id(
    app,
    "set_shortcut_popover",
    format!("Set Shortcut: Popover ({})…", pop),
    true,
    None::<&str>,
  )?;
  let set_sound = MenuItem::with_id(
    app,
    "set_shortcut_sound",
    format!("Set Shortcut: Sound ({})…", snd),
    true,
    None::<&str>,
  )?;

  let nm = display_from_spec(&cfg.notif_mode);

  let set_notif_mode = MenuItem::with_id(
    app,
    "set_shortcut_notif_mode",
    format!("Set Shortcut: Toggle Notify Mode ({})…", nm),
    true,
    None::<&str>,
  )?;

  let prev_tag = MenuItem::with_id(
    app,
    "set_shortcut_prev_tag",
    format!("Set Shortcut: Previous Tag ({})…", display_from_spec(&cfg.prev_tag)),
    true,
    None::<&str>,
  )?;

  let next_tag = MenuItem::with_id(
    app,
    "set_shortcut_next_tag",
    format!("Set Shortcut: Next Tag ({})…", display_from_spec(&cfg.next_tag)),
    true,
    None::<&str>,
  )?;

  let focus_create = MenuItem::with_id(
    app,
    "set_shortcut_focus_create",
    format!("Set Shortcut: Focus Add Task ({})…", display_from_spec(&cfg.focus_create)),
    true,
    None::<&str>,
  )?;

  let start_first = MenuItem::with_id(
    app,
    "set_shortcut_start_first",
    format!("Set Shortcut: Start First Task ({})…", display_from_spec(&cfg.start_first)),
    true,
    None::<&str>,
  )?;

  let shortcuts_menu = Submenu::with_items(
    app,
    "Shortcuts",
    true,
    &[
      &set_popover,
      &set_sound,
      &set_notif_mode,
      &prev_tag,
      &next_tag,
      &focus_create,
      &start_first,
    ],
  )?;

  // Theme items
  let theme_system = MenuItem::with_id(app, "theme_system", "System", true, None::<&str>)?;
  let theme_light = MenuItem::with_id(app, "theme_light", "Light", true, None::<&str>)?;
  let theme_dark = MenuItem::with_id(app, "theme_dark", "Dark", true, None::<&str>)?;
  let theme_menu = Submenu::with_items(
    app,
    "Theme",
    true,
    &[&theme_system, &theme_light, &theme_dark],
  )?;

  // Accent items
  let accent_pink = MenuItem::with_id(app, "accent_pink", "Pink", true, None::<&str>)?;
  let accent_purple = MenuItem::with_id(app, "accent_purple", "Purple", true, None::<&str>)?;
  let accent_blue = MenuItem::with_id(app, "accent_blue", "Blue", true, None::<&str>)?;
  let accent_gray = MenuItem::with_id(app, "accent_gray", "Warm Beige", true, None::<&str>)?;
  let accent_menu = Submenu::with_items(
    app,
    "Accent",
    true,
    &[&accent_pink, &accent_purple, &accent_blue, &accent_gray],
  )?;

  let about_menu = Submenu::with_items(app, "About", true, &[&version_item])?;
  let import_export_menu = Submenu::with_items(
    app,
    "Import",
    true,
    &[
      &MenuItem::with_id(app, "export_local_data", "Export Data…", true, None::<&str>)?,
      &MenuItem::with_id(app, "import_local_data", "Import Data…", true, None::<&str>)?,
    ],
  )?;

  let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

  Menu::with_items(
    app,
    &[
      &about_menu,
      &notif_mode_menu,
      &theme_menu,
      &accent_menu,
      &shortcuts_menu,
      &import_export_menu,
      &PredefinedMenuItem::separator(app)?,
      &quit_item,
    ],
  )
}

/// 注册快捷键（会打印 log，但不 panic）
fn register_shortcuts(app: &tauri::AppHandle, cfg: &ShortcutConfig) {
  let gs = app.global_shortcut();

  for target in all_shortcut_targets() {
    let Some(spec) = shortcut_spec_for_target(cfg, target) else { continue; };
    if let Ok(sc) = spec_to_shortcut(spec) {
      if let Err(e) = gs.register(sc) {
        eprintln!("❌ register {target} shortcut failed: {e}");
      } else {
        eprintln!("✅ registered {target} shortcut");
      }
    } else {
      eprintln!("❌ {target} shortcut invalid");
    }
  }

}

/// 取消注册旧快捷键（忽略错误）
fn unregister_shortcuts(app: &tauri::AppHandle, cfg: &ShortcutConfig) {
  let gs = app.global_shortcut();
  for target in all_shortcut_targets() {
    let Some(spec) = shortcut_spec_for_target(cfg, target) else { continue; };
    if let Ok(sc) = spec_to_shortcut(spec) {
      let _ = gs.unregister(sc);
    }
  }
  
}

/// -----------------------------
/// Commands
/// -----------------------------

/// ✅ Open system file picker safely in menubar/popover mode
/// Copies the selected MP3 into app storage and returns the stored file.
#[tauri::command]
async fn pick_audio(app: tauri::AppHandle) -> Result<Option<StoredAudio>, String> {
  let (tx, rx) = std::sync::mpsc::channel::<Result<Option<StoredAudio>, String>>();

  let app_ui = app.clone();
  let _ = app.run_on_main_thread(move || {
    if app_ui.is_popover_shown() {
      app_ui.hide_popover();
    }

    let app_after = app_ui.clone();
    app_ui
      .dialog()
      .file()
      .add_filter("MP3 Audio", &["mp3"])
      .pick_file(move |path_opt| {
        let picked = path_opt
          .map(|p| copy_audio_to_app_storage(&app_after, PathBuf::from(p.to_string())))
          .transpose();

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

  tauri::async_runtime::spawn_blocking(move || {
    rx.recv()
      .unwrap_or_else(|_| Err("dialog did not return a file".to_string()))
  })
    .await
    .map_err(|_| "dialog join error".to_string())?
}

#[tauri::command]
fn get_stored_audio(app: tauri::AppHandle) -> Result<Option<StoredAudio>, String> {
  let path = stored_audio_file_path(&app)?;

  if !path.exists() {
    return Ok(None);
  }

  Ok(Some(StoredAudio {
    path: path_to_string(path),
    name: "alarm.mp3".to_string(),
  }))
}

#[tauri::command]
fn clear_stored_audio(app: tauri::AppHandle) -> Result<(), String> {
  let path = stored_audio_file_path(&app)?;

  if path.exists() {
    fs::remove_file(path).map_err(|e| format!("clear stored MP3 failed: {}", e))?;
  }

  Ok(())
}

#[tauri::command]
async fn pick_import_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
  #[cfg(target_os = "macos")]
  {
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    let app_ui = app.clone();

    let _ = app.run_on_main_thread(move || unsafe {
      if app_ui.is_popover_shown() {
        app_ui.hide_popover();
      }

      activate_app_now();

      let panel: id = NSOpenPanel::openPanel(nil);
      let _: () = objc::msg_send![panel, center];
      let _: () = objc::msg_send![panel, setMessage: NSString::alloc(nil).init_str("Import YC Todo Data")];
      let _: () = objc::msg_send![panel, setAllowedFileTypes: build_json_types_array()];
      panel.setCanChooseFiles_(YES);
      panel.setCanChooseDirectories_(NO);
      panel.setAllowsMultipleSelection_(NO);

      if let Ok(downloads_dir) = app_ui.path().download_dir() {
        panel.setDirectoryURL(path_buf_to_nsurl(&downloads_dir));
      }

      let result = if panel.runModal() == NSModalResponse::NSModalResponseOk {
        nsurl_to_path_string(panel.URL())
      } else {
        None
      };

      activate_app_now();
      let _ = app_ui.show_popover();
      let _ = tx.send(result);
    });

    return tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
      .await
      .map_err(|_| "dialog join error".to_string());
  }

  #[cfg(not(target_os = "macos"))]
  {
  let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();

  let app_ui = app.clone();
  let _ = app.run_on_main_thread(move || {
    if app_ui.is_popover_shown() {
      app_ui.hide_popover();
    }

    let app_after = app_ui.clone();
    app_ui
      .dialog()
      .file()
      .add_filter("JSON", &["json"])
      .pick_file(move |path_opt| {
        let picked = path_opt.map(|p| p.to_string());

        let app_restore = app_after.clone();
        let _ = app_after.run_on_main_thread(move || {
          #[cfg(target_os = "macos")]
          {
            activate_app_now();
            let _ = app_restore.set_activation_policy(ActivationPolicy::Accessory);
          }
          let _ = app_restore.show_popover();
        });

        let _ = tx.send(picked);
      });
  });

  let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
    .await
    .map_err(|_| "dialog join error".to_string())?;

  Ok(picked)
  }
}

#[tauri::command]
async fn pick_export_file(
  app: tauri::AppHandle,
  default_file_name: String,
) -> Result<Option<String>, String> {
  #[cfg(target_os = "macos")]
  {
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    let app_ui = app.clone();

    let _ = app.run_on_main_thread(move || unsafe {
      if app_ui.is_popover_shown() {
        app_ui.hide_popover();
      }

      activate_app_now();

      let panel: id = NSSavePanel::savePanel(nil);
      let _: () = objc::msg_send![panel, center];
      let _: () = objc::msg_send![panel, setMessage: NSString::alloc(nil).init_str("Export YC Todo Data")];
      let _: () = objc::msg_send![panel, setAllowedFileTypes: build_json_types_array()];
      let _: () = objc::msg_send![panel, setNameFieldStringValue: NSString::alloc(nil).init_str(&default_file_name)];
      panel.setCanCreateDirectories(YES);

      if let Ok(downloads_dir) = app_ui.path().download_dir() {
        panel.setDirectoryURL(path_buf_to_nsurl(&downloads_dir));
      }

      let result = if panel.runModal() == NSModalResponse::NSModalResponseOk {
        nsurl_to_path_string(panel.URL())
      } else {
        None
      };

      activate_app_now();
      let _ = app_ui.show_popover();
      let _ = tx.send(result);
    });

    return tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
      .await
      .map_err(|_| "dialog join error".to_string());
  }

  #[cfg(not(target_os = "macos"))]
  {
  let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();

  let app_ui = app.clone();
  let _ = app.run_on_main_thread(move || {
    if app_ui.is_popover_shown() {
      app_ui.hide_popover();
    }

    let mut dialog = app_ui
      .dialog()
      .file()
      .add_filter("JSON", &["json"])
      .set_file_name(default_file_name);

    if let Ok(downloads_dir) = app_ui.path().download_dir() {
      dialog = dialog.set_directory(downloads_dir);
    }

    let app_after = app_ui.clone();
    dialog.save_file(move |path_opt| {
      let picked = path_opt.map(|p| p.to_string());

      let app_restore = app_after.clone();
      let _ = app_after.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        {
          activate_app_now();
          let _ = app_restore.set_activation_policy(ActivationPolicy::Accessory);
        }
        let _ = app_restore.show_popover();
      });

      let _ = tx.send(picked);
    });
  });

  let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
    .await
    .map_err(|_| "dialog join error".to_string())?;

  Ok(picked)
  }
}

/// ✅ Background-safe alarm playback (macOS)
#[tauri::command]
fn play_alarm(state: State<AlarmState>, path: String, volume: f32) -> Result<(), String> {
  {
    let mut guard = state
      .0
      .lock()
      .map_err(|_| "Alarm mutex poisoned".to_string())?;

    if let Some(mut child) = guard.take() {
      let _ = child.kill();
    }
  }

  let vol = volume.clamp(0.0, 1.0);

  let child = Command::new("afplay")
    .arg("-v")
    .arg(format!("{:.3}", vol))
    .arg(path)
    .spawn()
    .map_err(|e| format!("spawn afplay failed: {}", e))?;

  let mut guard = state
    .0
    .lock()
    .map_err(|_| "Alarm mutex poisoned".to_string())?;
  *guard = Some(child);

  Ok(())
}


#[tauri::command]
fn stop_alarm(state: State<AlarmState>) -> Result<(), String> {
  let mut guard = state.0.lock().map_err(|_| "Alarm mutex poisoned".to_string())?;
  if let Some(mut child) = guard.take() {
    let _ = child.kill();
  }
  Ok(())
}

#[tauri::command]
fn hide_popover_cmd(app: tauri::AppHandle) -> Result<(), String> {
  let app_ui = app.clone();
  let _ = app.run_on_main_thread(move || {
    if app_ui.is_popover_shown() {
      app_ui.hide_popover();
    }
  });
  Ok(())
}

#[tauri::command]
fn show_popover_cmd(app: tauri::AppHandle) -> Result<(), String> {
  let app_ui = app.clone();

  let _ = app.run_on_main_thread(move || {
    #[cfg(target_os = "macos")]
    activate_app_now();

    let _ = app_ui.show_popover();
  });

  Ok(())
}

#[tauri::command]
fn set_popover_pin(app: tauri::AppHandle, pinned: bool) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    use tauri_plugin_nspopover::AppExt as _;
    use objc2_app_kit::NSPopoverBehavior;

    let popover = app.ns_popover();
    popover.setBehavior(if pinned {
      NSPopoverBehavior::ApplicationDefined
    } else {
      NSPopoverBehavior::Transient
    });
  }

  Ok(())
}

/// ✅ 前端录完快捷键后调用：注册并持久化
#[tauri::command]
fn set_shortcut(
  app: tauri::AppHandle,
  state: State<ShortcutConfigState>,
  target: String, // "sound" | "popover"
  code: String,
  meta: bool,
  shift: bool,
  alt: bool,
  ctrl: bool,
) -> Result<(), String> {
  if shortcut_spec_for_target(&ShortcutConfig::default(), &target).is_none() {
    return Err("invalid target".to_string());
  }
  

  let new_spec = ShortcutSpec { meta, shift, alt, ctrl, code };

  // 校验：必须至少一个 modifier + 支持 code
  let new_sc = spec_to_shortcut(&new_spec)?;

  // 取旧配置
  let mut guard = state.0.lock().map_err(|_| "shortcut mutex poisoned".to_string())?;
  let mut cfg = guard.clone();

  for other_target in all_shortcut_targets() {
    if other_target == target {
      continue;
    }
    let Some(spec) = shortcut_spec_for_target(&cfg, other_target) else { continue; };
    if spec_to_shortcut(spec).ok().as_ref() == Some(&new_sc) {
      return Err("this shortcut is already used by another action".to_string());
    }
  } 

  let old_sc = shortcut_spec_for_target(&cfg, &target)
    .and_then(|spec| spec_to_shortcut(spec).ok());
  let gs = app.global_shortcut();
  if let Some(old_sc) = old_sc {
    let _ = gs.unregister(old_sc);
  }
  let Some(target_spec) = shortcut_spec_for_target_mut(&mut cfg, &target) else {
    return Err("invalid target".to_string());
  };
  *target_spec = new_spec;
  

  // 注册新的
  gs.register(new_sc).map_err(|e| format!("register new shortcut failed: {e}"))?;

  // 持久化 + 更新 state
  save_shortcuts(&app, &cfg);
  *guard = cfg.clone();

  // 更新 tray 菜单显示
  if let Some(tray) = app.tray_by_id("main") {
    if let Ok(menu) = rebuild_tray_menu(&app, &cfg) {
      let _ = tray.set_menu(Some(menu));
    }
  }

  // 回传给前端（用来关 overlay / toast）
  let display = shortcut_spec_for_target(&cfg, &target)
    .map(display_from_spec)
    .unwrap_or_default();
  

  let _ = app.emit(
    "ui://shortcut-updated",
    serde_json::json!({ "target": target, "display": display }),
  );

  Ok(())
}

#[tauri::command]
fn get_shortcuts(state: State<ShortcutConfigState>) -> Result<ShortcutConfig, String> {
  state
    .0
    .lock()
    .map(|cfg| cfg.clone())
    .map_err(|_| "shortcut mutex poisoned".to_string())
}

/// -----------------------------
/// Main entry
/// -----------------------------
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_nspopover::init())

    // ✅ Global shortcut plugin
    .plugin(
      tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
          if event.state() != ShortcutEventState::Pressed {
            return;
          }

          eprintln!("🔥 shortcut pressed: {:?}", shortcut); // ✅ 加这行
          // ✅ 动态读取当前配置（用户可改）
          let st = app.state::<ShortcutConfigState>();

          let cfg = st.0.lock().map(|g| g.clone()).unwrap_or_default();


          let pop = spec_to_shortcut(&cfg.popover).ok();
          let snd = spec_to_shortcut(&cfg.sound).ok();
          let nm = spec_to_shortcut(&cfg.notif_mode).ok();
          let prev_tag = spec_to_shortcut(&cfg.prev_tag).ok();
          let next_tag = spec_to_shortcut(&cfg.next_tag).ok();
          let start_first = spec_to_shortcut(&cfg.start_first).ok();
          let focus_create = spec_to_shortcut(&cfg.focus_create).ok();

          let is_pop = pop.as_ref().map(|s| shortcut == s).unwrap_or(false);
          let is_snd = snd.as_ref().map(|s| shortcut == s).unwrap_or(false);
          let is_nm = nm.as_ref().map(|s| shortcut == s).unwrap_or(false);
          let is_prev_tag = prev_tag.as_ref().map(|s| shortcut == s).unwrap_or(false);
          let is_next_tag = next_tag.as_ref().map(|s| shortcut == s).unwrap_or(false);
          let is_start_first = start_first.as_ref().map(|s| shortcut == s).unwrap_or(false);
          let is_focus_create = focus_create.as_ref().map(|s| shortcut == s).unwrap_or(false);

          if !is_pop
            && !is_snd
            && !is_nm
            && !is_prev_tag
            && !is_next_tag
            && !is_start_first
            && !is_focus_create
          {
            return;
          }

          let h = app.app_handle().clone();
          let h_ui = h.clone();

          let _ = h.run_on_main_thread(move || {
            if is_pop {
              if !h_ui.is_popover_shown() {
                h_ui.show_popover();
              } else {
                h_ui.hide_popover();
              }
              return;
            }

            if is_snd {
              if !h_ui.is_popover_shown() {
                h_ui.show_popover();
              }
              return;
            }

            if is_prev_tag || is_next_tag {
              if !h_ui.is_popover_shown() {
                h_ui.show_popover();
              }
              return;
            }

            if is_start_first && !h_ui.is_popover_shown() {
              h_ui.show_popover();
              return;
            }

            if is_focus_create && !h_ui.is_popover_shown() {
              h_ui.show_popover();
            }
          });

          if is_snd {
            let h_emit = h.clone();
            tauri::async_runtime::spawn(async move {
              std::thread::sleep(std::time::Duration::from_millis(80));
              let _ = h_emit.emit("ui://toggle-sound", ());
            });
          }

          if is_nm {
            let h = h.clone();
            let h_ui = h.clone();
          
            // 1) 先把 popover 弹出来（否则你看不到任何变化）
            let _ = h.run_on_main_thread(move || {
              if !h_ui.is_popover_shown() {
                h_ui.show_popover();
              }
            });
          
            // 2) 再 emit 给前端（给一点点时间让 webview ready）
            let h_emit = h.clone();
            tauri::async_runtime::spawn(async move {
              std::thread::sleep(std::time::Duration::from_millis(80));
              let _ = h_emit.emit("ui://toggle-notif-mode", ());
            });
          }

          if is_prev_tag || is_next_tag {
            let h_emit = h.clone();
            let direction = if is_prev_tag { "prev" } else { "next" };
            tauri::async_runtime::spawn(async move {
              std::thread::sleep(std::time::Duration::from_millis(80));
              let _ = h_emit.emit(
                "ui://switch-tag",
                serde_json::json!({ "direction": direction }),
              );
            });
          }

          if is_start_first {
            let h_emit = h.clone();
            tauri::async_runtime::spawn(async move {
              std::thread::sleep(std::time::Duration::from_millis(80));
              let _ = h_emit.emit("ui://start-first-visible-task", ());
            });
          }

          if is_focus_create {
            let h_emit = h.clone();
            tauri::async_runtime::spawn(async move {
              std::thread::sleep(std::time::Duration::from_millis(80));
              let _ = h_emit.emit("ui://focus-create-task", ());
            });
          }
          
          

        })
        .build(),
    )

    .manage(AlarmState(Mutex::new(None)))
    .manage(ShortcutConfigState(Mutex::new(ShortcutConfig::default())))


    .invoke_handler(tauri::generate_handler![
      pick_audio,
      get_stored_audio,
      clear_stored_audio,
      pick_import_file,
      pick_export_file,
      play_alarm,
      stop_alarm,
      hide_popover_cmd,
      show_popover_cmd, // ✅ 加这行
      set_shortcut,
      get_shortcuts,
      set_popover_pin
    ])

    .setup(|app| {
      eprintln!("✅ setup start");

      // ✅ macOS: menubar app (no Dock)
      #[cfg(target_os = "macos")]
      {
        let _ = app.set_activation_policy(ActivationPolicy::Accessory);
      }

      // ✅ main window -> popover
      let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => {
          eprintln!("❌ missing window label=main (check tauri.conf.json windows label)");
          return Ok(());
        }
      };

      window.to_popover(ToPopoverOptions {
        is_fullsize_content: true,
      });

      #[cfg(target_os = "macos")]
      {
        use tauri_plugin_nspopover::AppExt as _;
        use objc2_app_kit::NSPopoverBehavior;

        let handle = app.handle();
        let popover = handle.ns_popover();
        popover.setBehavior(NSPopoverBehavior::Transient); // ✅ 默认：点外面就自动收起
      }


      // ✅ 防止 close 退出：close => hide popover
      let handle_for_close = app.handle().clone();
      window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
          api.prevent_close();

          let h = handle_for_close.clone();
          let h_ui = h.clone();
          let _ = h.run_on_main_thread(move || {
            if h_ui.is_popover_shown() {
              h_ui.hide_popover();
            }
          });
        }
      });

      // tray
      let tray = match app.tray_by_id("main") {
        Some(t) => t,
        None => {
          eprintln!("❌ missing trayIcon id=main (check tauri.conf.json tray id)");
          return Ok(());
        }
      };

      // ✅ load shortcuts from disk -> set state -> register
      let loaded = load_shortcuts(&app.handle());
      {
        {
          let st = app.state::<ShortcutConfigState>();
          let lock_result = st.0.lock();
          if let Ok(mut g) = lock_result {
            *g = loaded.clone();
          }
        }
        
        
      }

      // 先确保不会重复注册（开发热重载时）
      unregister_shortcuts(&app.handle(), &loaded);
      register_shortcuts(&app.handle(), &loaded);

      // build menu（包含快捷键设置项）
      let menu = rebuild_tray_menu(&app.handle(), &loaded)?;
      tray.set_menu(Some(menu))?;
      tray.set_show_menu_on_left_click(false)?;

      // ---------- Menu events ----------
      let app_handle_for_menu = app.handle().clone();
      tray.on_menu_event(move |_tray, event| match event.id().as_ref() {
        "quit" => app_handle_for_menu.exit(0),
        "notif_mode_sound" | "notif_mode_quiet" => {
          let next_mode = if event.id().as_ref() == "notif_mode_sound" {
            "sound"
          } else {
            "quiet"
          };

          let outer = app_handle_for_menu.clone();
          let inner = outer.clone();

          let _ = outer.run_on_main_thread(move || {
            if !inner.is_popover_shown() {
              inner.show_popover();
            }
          });

          let emit_handle = app_handle_for_menu.clone();
          tauri::async_runtime::spawn(async move {
            std::thread::sleep(std::time::Duration::from_millis(80));
            let _ = emit_handle.emit(
              "ui://set-notification-mode",
              serde_json::json!({ "mode": next_mode }),
            );
          });
        }

        "set_shortcut_popover" => emit_shortcut_capture(app_handle_for_menu.clone(), "popover"),
        "set_shortcut_sound" => emit_shortcut_capture(app_handle_for_menu.clone(), "sound"),
        "set_shortcut_notif_mode" => emit_shortcut_capture(app_handle_for_menu.clone(), "notif_mode"),
        "set_shortcut_prev_tag" => emit_shortcut_capture(app_handle_for_menu.clone(), "prev_tag"),
        "set_shortcut_next_tag" => emit_shortcut_capture(app_handle_for_menu.clone(), "next_tag"),
        "set_shortcut_focus_create" => emit_shortcut_capture(app_handle_for_menu.clone(), "focus_create"),
        "set_shortcut_start_first" => emit_shortcut_capture(app_handle_for_menu.clone(), "start_first"),



        "theme_system" => { let _ = app_handle_for_menu.emit("settings://theme", "system"); }
        "theme_light" => { let _ = app_handle_for_menu.emit("settings://theme", "light"); }
        "theme_dark" => { let _ = app_handle_for_menu.emit("settings://theme", "dark"); }

        "accent_pink" => { let _ = app_handle_for_menu.emit("settings://accent", "#d4a5c1"); }
        "accent_purple" => { let _ = app_handle_for_menu.emit("settings://accent", "#B19CD9"); }
        "accent_blue" => { let _ = app_handle_for_menu.emit("settings://accent", "#6C8FF5"); }
        "accent_gray" => { let _ = app_handle_for_menu.emit("settings://accent", "#D1C0A8"); } //4b4b4b D9CFBE D6C8B4
        "export_local_data" => {
          let _ = app_handle_for_menu.emit("ui://export-local-data", ());
        }
        "import_local_data" => {
          let _ = app_handle_for_menu.emit("ui://import-local-data", ());
        }

        _ => {}
      });

      // ---------- Left click toggles popover ----------
      let handle = app.handle().clone();
      tray.on_tray_icon_event(move |_, event| {
        if let tauri::tray::TrayIconEvent::Click { button, button_state, .. } = event {
          if button == tauri::tray::MouseButton::Left
            && button_state == tauri::tray::MouseButtonState::Up
          {
            let h = handle.clone();
            let h_ui = h.clone();
            let _ = h.run_on_main_thread(move || {
              if !h_ui.is_popover_shown() {
                h_ui.show_popover();
              } else {
                h_ui.hide_popover();
              }
            });
          }
        }
      });

      // ✅ 首次啟動：延遲一下再彈出 popover
      let h = app.handle().clone();
      tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        let h2 = h.clone();
        let _ = h.run_on_main_thread(move || {
          let _ = h2.show_popover();
        });
      });

      eprintln!("✅ setup done");
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
