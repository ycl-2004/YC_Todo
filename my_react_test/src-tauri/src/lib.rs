// src-tauri/src/lib.rs

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{ActivationPolicy, Emitter, Manager, State};

use tauri_plugin_dialog::DialogExt;
use tauri_plugin_nspopover::{AppExt as _, ToPopoverOptions, WindowExt as _};

use tauri_plugin_global_shortcut::{
  Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState as ShortcutEventState,
};

struct AlarmState(Mutex<Option<Child>>);

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
struct ShortcutConfig {
  popover: ShortcutSpec,
  sound: ShortcutSpec,
  notif_mode: ShortcutSpec, // ✅ NEW
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
        code: "KeyK".to_string(),
      },
      notif_mode: ShortcutSpec { // ✅ NEW
        meta: true,
        shift: true,
        alt: false,
        ctrl: false,
        code: "KeyL".to_string(),
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
  // 支持：KeyA..KeyZ / Digit0..Digit9（够你现在用）
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

  None
}

fn spec_to_shortcut(spec: &ShortcutSpec) -> Result<Shortcut, String> {
  let mods = to_modifiers(spec).ok_or("shortcut must include at least one modifier")?;
  let code = code_from_js(&spec.code).ok_or("unsupported key code (only KeyA..KeyZ / Digit0..9 for now)")?;
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

fn rebuild_tray_menu<R: tauri::Runtime>(
  app: &tauri::AppHandle<R>,
  cfg: &ShortcutConfig,
) -> Result<Menu<R>, tauri::Error> {
  let version_str = format!("Version {}", env!("CARGO_PKG_VERSION"));
  let version_item = MenuItem::with_id(app, "version", version_str, false, None::<&str>)?;

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


  // Theme items
  let theme_system = MenuItem::with_id(app, "theme_system", "Theme: System", true, None::<&str>)?;
  let theme_light = MenuItem::with_id(app, "theme_light", "Theme: Light", true, None::<&str>)?;
  let theme_dark = MenuItem::with_id(app, "theme_dark", "Theme: Dark", true, None::<&str>)?;

  // Accent items
  let accent_pink = MenuItem::with_id(app, "accent_pink", "Accent: Pink", true, None::<&str>)?;
  let accent_purple = MenuItem::with_id(app, "accent_purple", "Accent: Purple", true, None::<&str>)?;
  let accent_blue = MenuItem::with_id(app, "accent_blue", "Accent: Blue", true, None::<&str>)?;
  let accent_gray = MenuItem::with_id(app, "accent_gray", "Accent: Warm Beige", true, None::<&str>)?;


  let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

  Menu::with_items(
    app,
    &[
      &version_item,
      &PredefinedMenuItem::separator(app)?,
      &set_popover,
      &set_sound,
      &set_notif_mode,
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
  )
}

/// 注册快捷键（会打印 log，但不 panic）
fn register_shortcuts(app: &tauri::AppHandle, cfg: &ShortcutConfig) {
  let gs = app.global_shortcut();

  let pop = spec_to_shortcut(&cfg.popover);
  let snd = spec_to_shortcut(&cfg.sound);

  if let Ok(sc) = pop {
    if let Err(e) = gs.register(sc) {
      eprintln!("❌ register popover shortcut failed: {e}");
    } else {
      eprintln!("✅ registered popover shortcut");
    }
  } else {
    eprintln!("❌ popover shortcut invalid");
  }

  if let Ok(sc) = snd {
    if let Err(e) = gs.register(sc) {
      eprintln!("❌ register sound shortcut failed: {e}");
    } else {
      eprintln!("✅ registered sound shortcut");
    }
  } else {
    eprintln!("❌ sound shortcut invalid");
  }

  let nm = spec_to_shortcut(&cfg.notif_mode);

  if let Ok(sc) = nm {
    if let Err(e) = gs.register(sc) {
      eprintln!("❌ register notif_mode shortcut failed: {e}");
    } else {
      eprintln!("✅ registered notif_mode shortcut");
    }
  } else {
    eprintln!("❌ notif_mode shortcut invalid");
  }

}

/// 取消注册旧快捷键（忽略错误）
fn unregister_shortcuts(app: &tauri::AppHandle, cfg: &ShortcutConfig) {
  let gs = app.global_shortcut();

  if let Ok(sc) = spec_to_shortcut(&cfg.popover) {
    let _ = gs.unregister(sc);
  }
  if let Ok(sc) = spec_to_shortcut(&cfg.sound) {
    let _ = gs.unregister(sc);
  }

  if let Ok(sc) = spec_to_shortcut(&cfg.notif_mode) {
    let _ = gs.unregister(sc);
  }
  
}

/// -----------------------------
/// Commands
/// -----------------------------

/// ✅ Open system file picker safely in menubar/popover mode
/// Returns: Some(path) or None
#[tauri::command]
async fn pick_audio(app: tauri::AppHandle) -> Result<Option<String>, String> {
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
      .add_filter("Audio", &["mp3", "m4a", "wav", "aac"])
      .pick_file(move |path_opt| {
        let picked = path_opt.map(|p| p.to_string());

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
    // ✅ 只负责弹出 popover（不碰 activation policy，不会把 Dock 弹出来）
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
  if target != "sound" && target != "popover" && target != "notif_mode" {
    return Err("invalid target".to_string());
  }
  

  let new_spec = ShortcutSpec { meta, shift, alt, ctrl, code };

  // 校验：必须至少一个 modifier + 支持 code
  let new_sc = spec_to_shortcut(&new_spec)?;

  // 取旧配置
  let mut guard = state.0.lock().map_err(|_| "shortcut mutex poisoned".to_string())?;
  let mut cfg = guard.clone();

  // 冲突校验：两个动作不能用同一个 shortcut
  let mut used = Vec::new();
  used.push(spec_to_shortcut(&cfg.popover).ok());
  used.push(spec_to_shortcut(&cfg.sound).ok());
  used.push(spec_to_shortcut(&cfg.notif_mode).ok());

  let conflict = match target.as_str() {
    "popover" => {
      spec_to_shortcut(&cfg.sound).ok().as_ref() == Some(&new_sc)
        || spec_to_shortcut(&cfg.notif_mode).ok().as_ref() == Some(&new_sc)
    }
    "sound" => {
      spec_to_shortcut(&cfg.popover).ok().as_ref() == Some(&new_sc)
        || spec_to_shortcut(&cfg.notif_mode).ok().as_ref() == Some(&new_sc)
    }
    "notif_mode" => {
      spec_to_shortcut(&cfg.popover).ok().as_ref() == Some(&new_sc)
        || spec_to_shortcut(&cfg.sound).ok().as_ref() == Some(&new_sc)
    }
    _ => false,
  };

  if conflict {
    return Err("this shortcut is already used by another action".to_string());
  } 


  // 先取消注册旧的（只取消 target 的旧值）
  let gs = app.global_shortcut();
  if target == "popover" {
    if let Ok(old_sc) = spec_to_shortcut(&cfg.popover) { let _ = gs.unregister(old_sc); }
    cfg.popover = new_spec;
  } else if target == "sound" {
    if let Ok(old_sc) = spec_to_shortcut(&cfg.sound) { let _ = gs.unregister(old_sc); }
    cfg.sound = new_spec;
  } else {
    if let Ok(old_sc) = spec_to_shortcut(&cfg.notif_mode) { let _ = gs.unregister(old_sc); }
    cfg.notif_mode = new_spec;
  }
  

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
  let display = if target == "popover" {
    display_from_spec(&cfg.popover)
  } else if target == "sound" {
    display_from_spec(&cfg.sound)
  } else {
    display_from_spec(&cfg.notif_mode)
  };
  

  let _ = app.emit(
    "ui://shortcut-updated",
    serde_json::json!({ "target": target, "display": display }),
  );

  Ok(())
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

          let is_pop = pop.as_ref().map(|s| shortcut == s).unwrap_or(false);
          let is_snd = snd.as_ref().map(|s| shortcut == s).unwrap_or(false);
          let is_nm = nm.as_ref().map(|s| shortcut == s).unwrap_or(false);

          if !is_pop && !is_snd && !is_nm {
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
          
          

        })
        .build(),
    )

    .manage(AlarmState(Mutex::new(None)))
    .manage(ShortcutConfigState(Mutex::new(ShortcutConfig::default())))


    .invoke_handler(tauri::generate_handler![
      pick_audio,
      play_alarm,
      stop_alarm,
      hide_popover_cmd,
      show_popover_cmd, // ✅ 加这行
      set_shortcut,
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

        "set_shortcut_popover" => {
          let outer = app_handle_for_menu.clone();
          let inner = outer.clone(); // ✅ 给 closure 用

          let _ = outer.run_on_main_thread(move || {
            if !inner.is_popover_shown() {
              inner.show_popover();
            }
          });

          let emit_handle = app_handle_for_menu.clone();
          tauri::async_runtime::spawn(async move {
            std::thread::sleep(std::time::Duration::from_millis(60));
            let _ = emit_handle.emit(
              "ui://capture-shortcut",
              serde_json::json!({ "target": "popover" }),
            );
          });
        }

        "set_shortcut_sound" => {
          let outer = app_handle_for_menu.clone();
          let inner = outer.clone();

          let _ = outer.run_on_main_thread(move || {
            if !inner.is_popover_shown() {
              inner.show_popover();
            }
          });

          let emit_handle = app_handle_for_menu.clone();
          tauri::async_runtime::spawn(async move {
            std::thread::sleep(std::time::Duration::from_millis(60));
            let _ = emit_handle.emit(
              "ui://capture-shortcut",
              serde_json::json!({ "target": "sound" }),
            );
          });
        }

        "set_shortcut_notif_mode" => {
          let outer = app_handle_for_menu.clone();
          let inner = outer.clone();

          let _ = outer.run_on_main_thread(move || {
            if !inner.is_popover_shown() {
              inner.show_popover();
            }
          });

          let emit_handle = app_handle_for_menu.clone();
          tauri::async_runtime::spawn(async move {
            std::thread::sleep(std::time::Duration::from_millis(60));
            let _ = emit_handle.emit(
              "ui://capture-shortcut",
              serde_json::json!({ "target": "notif_mode" }),
            );
          });
        }



        "theme_system" => { let _ = app_handle_for_menu.emit("settings://theme", "system"); }
        "theme_light" => { let _ = app_handle_for_menu.emit("settings://theme", "light"); }
        "theme_dark" => { let _ = app_handle_for_menu.emit("settings://theme", "dark"); }

        "accent_pink" => { let _ = app_handle_for_menu.emit("settings://accent", "#d4a5c1"); }
        "accent_purple" => { let _ = app_handle_for_menu.emit("settings://accent", "#B19CD9"); }
        "accent_blue" => { let _ = app_handle_for_menu.emit("settings://accent", "#6C8FF5"); }
        "accent_gray" => { let _ = app_handle_for_menu.emit("settings://accent", "#D1C0A8"); } //4b4b4b D9CFBE D6C8B4

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