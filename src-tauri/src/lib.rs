use tauri::{Emitter, Manager};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // macOS only: replace the default Quit item with a custom one so
            // Cmd+Q emits "menu-quit" to JS instead of terminating directly via
            // NSTerminateNow, which bypasses the unsaved-changes guard.
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
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.emit("menu-quit", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![quit_app, set_document_edited])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
