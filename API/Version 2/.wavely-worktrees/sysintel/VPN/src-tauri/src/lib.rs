//! Wavely Protection — Tauri backend entry point.
//!
//! Owned by the foundation. Registers plugins, builds the system tray, starts
//! each engine's background tasks, and exposes the full command surface. Engine
//! agents fill in their own module (`shield`, `vpn`, `sysintel`); they should
//! not need to edit this file unless they add a brand-new command.

mod common;
mod shield;
mod sysintel;
mod vpn;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            // System tray with quick actions (Control Hub agent can expand).
            let show = MenuItem::with_id(app, "show", "Open Wavely", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Wavely", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Wavely Protection")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Start each engine's background tasks.
            let handle = app.handle();
            shield::start(handle);
            vpn::start(handle);
            sysintel::start(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Shield
            shield::shield_get_status,
            shield::shield_set_realtime,
            shield::shield_quick_scan,
            shield::shield_full_scan,
            shield::shield_scan_path,
            shield::shield_cancel_scan,
            shield::shield_list_quarantine,
            shield::shield_quarantine_restore,
            shield::shield_quarantine_delete,
            shield::shield_get_threat_log,
            shield::shield_update_rules,
            // VPN
            vpn::vpn_get_status,
            vpn::vpn_list_servers,
            vpn::vpn_import_config,
            vpn::vpn_connect,
            vpn::vpn_disconnect,
            vpn::vpn_set_killswitch,
            vpn::vpn_set_dns,
            vpn::vpn_get_stats,
            // System Intelligence
            sysintel::sys_get_overview,
            sysintel::sys_get_processes,
            sysintel::sys_kill_process,
            sysintel::sys_get_startup_items,
            sysintel::sys_get_network_connections,
            sysintel::sys_get_disks,
            sysintel::sys_get_installed_software,
            sysintel::sys_get_drivers,
            sysintel::sys_advanced_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
