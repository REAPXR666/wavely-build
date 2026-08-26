//! Wavely VPN Core — WireGuard tunnel engine.
//!
//! FOUNDATION STUB: data types + command surface. The VPN agent owns this
//! module and `src/features/vpn/**`. v1 supports a real bring-your-own
//! WireGuard config plus a clearly-labeled "demo" connection mode.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct VpnState {
    pub connected: bool,
    pub kill_switch: bool,
    pub server_id: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct VpnStatus {
    pub connected: bool,
    pub server_id: Option<String>,
    pub kill_switch: bool,
    /// "demo" | "real"
    pub mode: String,
    pub since: Option<u64>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct VpnServer {
    pub id: String,
    pub country: String,
    pub city: String,
    /// Emoji flag or asset key.
    pub flag: String,
    pub ping_ms: u32,
    /// 0-100 percent.
    pub load: u8,
    /// true => simulated demo node.
    pub demo: bool,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct VpnStats {
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub rx_rate: u64,
    pub tx_rate: u64,
    pub last_handshake: Option<u64>,
}

// ---------------------------------------------------------------------------
// Commands (contract). Implemented by the VPN agent.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn vpn_get_status() -> VpnStatus {
    VpnStatus {
        mode: "demo".into(),
        ..Default::default()
    }
}

#[tauri::command]
pub async fn vpn_list_servers() -> Vec<VpnServer> {
    Vec::new()
}

#[tauri::command]
pub async fn vpn_import_config(config: String) -> Result<String, String> {
    let _ = config;
    Ok("imported".into())
}

#[tauri::command]
pub async fn vpn_connect(server_id: Option<String>) -> Result<VpnStatus, String> {
    let _ = server_id;
    Ok(VpnStatus {
        mode: "demo".into(),
        ..Default::default()
    })
}

#[tauri::command]
pub async fn vpn_disconnect() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn vpn_set_killswitch(enabled: bool) -> Result<(), String> {
    let _ = enabled;
    Ok(())
}

#[tauri::command]
pub async fn vpn_set_dns(servers: Vec<String>) -> Result<(), String> {
    let _ = servers;
    Ok(())
}

#[tauri::command]
pub async fn vpn_get_stats() -> VpnStats {
    VpnStats::default()
}

/// Initialize VPN engine state + background tasks.
pub fn start(app: &AppHandle) {
    app.manage(Mutex::new(VpnState::default()));
}
