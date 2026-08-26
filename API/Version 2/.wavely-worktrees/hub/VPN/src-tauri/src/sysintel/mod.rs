//! Wavely System Intelligence — diagnostics + live monitoring.
//!
//! FOUNDATION: data types + command contract (stubs) PLUS a working live
//! telemetry emitter so the foundation already streams real CPU/memory data
//! to the dashboard. The System Intelligence agent owns this module and
//! `src/features/system/**`, and expands the stubbed commands with real data.

use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::common::{events, now_ms};

#[derive(Default)]
pub struct SysState;

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Telemetry {
    pub ts: u64,
    pub cpu_usage: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub net_rx_rate: u64,
    pub net_tx_rate: u64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemOverview {
    pub host_name: String,
    pub os: String,
    pub kernel: String,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub mem_total: u64,
    pub uptime: u64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu: f32,
    pub mem: u64,
    pub parent: Option<u32>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    pub name: String,
    pub location: String,
    /// e.g. "Registry Run Key", "Startup Folder", "Scheduled Task", "Service"
    pub kind: String,
    /// "low" | "medium" | "high"
    pub risk: String,
    pub signed: bool,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetConnection {
    pub proto: String,
    pub local: String,
    pub remote: String,
    pub pid: Option<u32>,
    pub state: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub name: String,
    pub mount: String,
    pub total: u64,
    pub available: u64,
    /// "SSD" | "HDD" | "Unknown"
    pub kind: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareItem {
    pub name: String,
    pub version: String,
    pub publisher: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DriverItem {
    pub name: String,
    pub version: String,
    pub signed: bool,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedInfo {
    pub secure_boot: Option<bool>,
    pub tpm_present: Option<bool>,
    pub virtualization: Option<bool>,
}

// ---------------------------------------------------------------------------
// Commands (contract). Stubs expanded by the System Intelligence agent.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn sys_get_overview() -> SystemOverview {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_all();
    let cpu_brand = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_default();
    SystemOverview {
        host_name: System::host_name().unwrap_or_default(),
        os: System::long_os_version().unwrap_or_default(),
        kernel: System::kernel_version().unwrap_or_default(),
        cpu_brand,
        cpu_cores: sys.cpus().len(),
        mem_total: sys.total_memory(),
        uptime: System::uptime(),
    }
}

#[tauri::command]
pub async fn sys_get_processes() -> Vec<ProcessInfo> {
    Vec::new()
}

#[tauri::command]
pub async fn sys_kill_process(pid: u32) -> Result<bool, String> {
    let _ = pid;
    Ok(false)
}

#[tauri::command]
pub async fn sys_get_startup_items() -> Vec<StartupItem> {
    Vec::new()
}

#[tauri::command]
pub async fn sys_get_network_connections() -> Vec<NetConnection> {
    Vec::new()
}

#[tauri::command]
pub async fn sys_get_disks() -> Vec<DiskInfo> {
    Vec::new()
}

#[tauri::command]
pub async fn sys_get_installed_software() -> Vec<SoftwareItem> {
    Vec::new()
}

#[tauri::command]
pub async fn sys_get_drivers() -> Vec<DriverItem> {
    Vec::new()
}

#[tauri::command]
pub async fn sys_advanced_info() -> AdvancedInfo {
    AdvancedInfo::default()
}

/// Initialize System Intelligence state + start the live telemetry thread.
///
/// Runs on a dedicated OS thread (sysinfo's `System` is not held across an
/// async await point this way) and emits `sys://telemetry` every second.
pub fn start(app: &AppHandle) {
    app.manage(Mutex::new(SysState));

    let handle = app.clone();
    std::thread::spawn(move || {
        use sysinfo::{CpuRefreshKind, MemoryRefreshKind, Networks, RefreshKind, System};
        let mut sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::everything())
                .with_memory(MemoryRefreshKind::everything()),
        );
        // `received()` / `transmitted()` report bytes since the previous refresh,
        // so refreshing on a ~1s cadence yields a per-second throughput rate.
        let mut networks = Networks::new_with_refreshed_list();

        // Prime CPU usage (needs two samples to be meaningful).
        sys.refresh_cpu_usage();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);

        loop {
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            networks.refresh(true);

            let mut net_rx_rate = 0u64;
            let mut net_tx_rate = 0u64;
            for (_iface, data) in &networks {
                net_rx_rate += data.received();
                net_tx_rate += data.transmitted();
            }

            let telemetry = Telemetry {
                ts: now_ms(),
                cpu_usage: sys.global_cpu_usage(),
                mem_used: sys.used_memory(),
                mem_total: sys.total_memory(),
                net_rx_rate,
                net_tx_rate,
            };
            let _ = handle.emit(events::SYS_TELEMETRY, telemetry);
            std::thread::sleep(Duration::from_millis(1000));
        }
    });
}
