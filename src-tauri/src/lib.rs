use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// ─── Recent files ────────────────────────────────────────────────────────────

struct RecentFiles {
    path: PathBuf,
    entries: Mutex<Vec<String>>,
}

impl RecentFiles {
    fn load(path: PathBuf) -> Self {
        let entries = std::fs::read_to_string(&path)
            .unwrap_or_default()
            .lines()
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect();
        Self { path, entries: Mutex::new(entries) }
    }
    fn persist(&self) {
        let entries = self.entries.lock().unwrap();
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&self.path, entries.join("\n"));
    }
}

#[tauri::command]
fn get_recent_files(state: tauri::State<'_, RecentFiles>) -> Vec<String> {
    state.entries.lock().unwrap().clone()
}

#[tauri::command]
fn add_recent_file(state: tauri::State<'_, RecentFiles>, path: String) {
    {
        let mut entries = state.entries.lock().unwrap();
        entries.retain(|e| e != &path);
        entries.insert(0, path);
        entries.truncate(10);
    }
    state.persist();
}

// ─── Startup file (Windows / Linux only) ────────────────────────────────────
// macOS file associations are handled by tauri-plugin-deep-link, which
// intercepts application:openURLs: before tao's run-callback is wired up,
// preventing the launch-time panic that the raw RunEvent::Opened approach causes.

struct StartupFile {
    path: Mutex<Option<String>>,
}

#[tauri::command]
fn get_startup_file(state: tauri::State<'_, StartupFile>) -> Option<String> {
    state.path.lock().unwrap().take()
}

// ─── Window / app commands ───────────────────────────────────────────────────

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn set_document_edited(_window: tauri::WebviewWindow, _edited: bool) {
    #[cfg(target_os = "macos")]
    {
        use objc2::{msg_send, runtime::AnyObject};
        if let Ok(ptr) = _window.ns_window() {
            unsafe {
                let ns_win: *mut AnyObject = ptr.cast();
                let _: () = msg_send![&*ns_win, setDocumentEdited: _edited];
            }
        }
    }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let recent_path = app.path().app_data_dir()
                .map(|d| d.join("recent.txt"))
                .unwrap_or_else(|_| PathBuf::from("recent.txt"));
            app.manage(RecentFiles::load(recent_path));

            // Windows / Linux: file associations pass the path as argv[1].
            // macOS uses tauri-plugin-deep-link (getCurrent / onOpenUrl in JS).
            let startup_path: Option<String> = {
                #[cfg(not(target_os = "macos"))]
                {
                    std::env::args().nth(1).filter(|arg| {
                        std::path::Path::new(arg).exists()
                    })
                }
                #[cfg(target_os = "macos")]
                { None }
            };
            app.manage(StartupFile { path: Mutex::new(startup_path) });

            // macOS: replace the default Quit so Cmd+Q emits "wants-quit" to JS
            // instead of terminating via NSTerminateNow, bypassing the dirty guard.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
                let quit = MenuItem::with_id(app, "quit", "Quit QEdit", true, Some("cmd+q"))?;
                let submenu = Submenu::with_items(app, "QEdit", true, &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ])?;
                app.set_menu(Menu::with_items(app, &[&submenu])?)?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                let wins = app.webview_windows();
                if wins.is_empty() {
                    app.exit(0);
                } else {
                    for (_, win) in &wins {
                        let _ = win.emit("wants-quit", ());
                    }
                }
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if window.app_handle().webview_windows().is_empty() {
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            quit_app,
            set_document_edited,
            get_recent_files,
            add_recent_file,
            get_startup_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
