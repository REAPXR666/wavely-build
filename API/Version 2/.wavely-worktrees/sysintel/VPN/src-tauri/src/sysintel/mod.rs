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

// ── State ────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct SysState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

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

// ── Shared helpers ───────────────────────────────────────────────────────────

/// Risk-score a startup item's launch path + registration kind.
fn score_startup_risk(location: &str, kind: &str) -> String {
    let loc = location.to_lowercase();
    let loc = loc.trim_matches('"');

    // High risk: script extensions or temp/throwaway paths
    if loc.ends_with(".bat")
        || loc.ends_with(".vbs")
        || loc.ends_with(".ps1")
        || loc.ends_with(".cmd")
        || loc.ends_with(".wsf")
        || loc.ends_with(".js")
        || loc.contains("\\temp\\")
        || loc.contains("\\tmp\\")
    {
        return "high".to_string();
    }

    // Medium risk: RunOnce (temporary persistence) or user-scoped AppData
    if kind.contains("RunOnce")
        || loc.contains("\\appdata\\roaming\\")
        || loc.contains("\\appdata\\local\\")
        || (loc.contains("\\users\\") && !loc.contains("\\program files"))
    {
        return "medium".to_string();
    }

    // Low risk: well-known system / application directories
    if loc.contains("\\windows\\")
        || loc.contains("\\program files\\")
        || loc.contains("\\program files (x86)\\")
    {
        return "low".to_string();
    }

    "medium".to_string()
}

/// Heuristic: is this executable in a location that is typically signed?
/// (Real PE-signature check is out of scope; this is path-based.)
fn is_likely_signed(location: &str) -> bool {
    let loc = location.to_lowercase();
    let loc = loc.trim_start_matches('"');
    loc.starts_with("c:\\windows\\")
        || loc.starts_with("c:\\program files\\")
        || loc.starts_with("c:\\program files (x86)\\")
}

// ── Windows registry helpers ─────────────────────────────────────────────────

#[cfg(windows)]
fn reg_decode_sz(value: &winreg::RegValue) -> String {
    use winreg::enums::{REG_EXPAND_SZ, REG_SZ};
    if matches!(value.vtype, REG_SZ | REG_EXPAND_SZ) && value.bytes.len() >= 2 {
        let words: Vec<u16> = value
            .bytes
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect();
        return String::from_utf16_lossy(&words)
            .trim_end_matches('\0')
            .to_string();
    }
    String::new()
}

#[cfg(windows)]
fn collect_reg_startup(
    root: winreg::RegKey,
    path: &str,
    kind: &str,
    items: &mut Vec<StartupItem>,
) {
    if let Ok(key) = root.open_subkey(path) {
        for result in key.enum_values() {
            if let Ok((name, value)) = result {
                let location = reg_decode_sz(&value);
                if location.is_empty() {
                    continue;
                }
                let risk = score_startup_risk(&location, kind);
                let signed = is_likely_signed(&location);
                items.push(StartupItem {
                    name,
                    location,
                    kind: kind.to_string(),
                    risk,
                    signed,
                });
            }
        }
    }
}

// ── Platform implementation: startup items ───────────────────────────────────

#[cfg(windows)]
fn get_startup_items_impl() -> Vec<StartupItem> {
    use winreg::{enums::*, RegKey};

    let mut items = Vec::new();

    collect_reg_startup(
        RegKey::predef(HKEY_CURRENT_USER),
        "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        "Registry Run (HKCU)",
        &mut items,
    );
    collect_reg_startup(
        RegKey::predef(HKEY_CURRENT_USER),
        "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
        "Registry RunOnce (HKCU)",
        &mut items,
    );
    collect_reg_startup(
        RegKey::predef(HKEY_LOCAL_MACHINE),
        "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        "Registry Run (HKLM)",
        &mut items,
    );
    collect_reg_startup(
        RegKey::predef(HKEY_LOCAL_MACHINE),
        "Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce",
        "Registry RunOnce (HKLM)",
        &mut items,
    );
    collect_reg_startup(
        RegKey::predef(HKEY_LOCAL_MACHINE),
        "Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Run",
        "Registry Run (HKLM 32-bit)",
        &mut items,
    );

    // Startup folders
    let user_startup = std::env::var("APPDATA")
        .map(|v| format!("{}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup", v))
        .unwrap_or_default();

    let startup_dirs = [
        (user_startup.as_str(), "Startup Folder (User)"),
        (
            "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup",
            "Startup Folder (All Users)",
        ),
    ];

    for (dir, kind) in &startup_dirs {
        if dir.is_empty() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string()) {
                    if name.starts_with('.') {
                        continue;
                    }
                    let location = path.to_string_lossy().to_string();
                    let risk = score_startup_risk(&location, kind);
                    let signed = is_likely_signed(&location);
                    items.push(StartupItem {
                        name,
                        location,
                        kind: kind.to_string(),
                        risk,
                        signed,
                    });
                }
            }
        }
    }

    items
}

#[cfg(not(windows))]
fn get_startup_items_impl() -> Vec<StartupItem> {
    // macOS: enumerate LaunchAgent plist files (best-effort, no plist parsing)
    let mut items = Vec::new();
    let user_agents = std::env::var("HOME")
        .map(|h| std::path::PathBuf::from(h).join("Library/LaunchAgents"))
        .ok();
    let system_dirs = [
        std::path::PathBuf::from("/Library/LaunchAgents"),
        std::path::PathBuf::from("/Library/LaunchDaemons"),
    ];
    let mut dirs: Vec<std::path::PathBuf> = system_dirs.to_vec();
    if let Some(ud) = user_agents {
        dirs.push(ud);
    }
    for dir in dirs {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |e| e == "plist") {
                    if let Some(name) =
                        path.file_stem().map(|n| n.to_string_lossy().to_string())
                    {
                        let location = path.to_string_lossy().to_string();
                        items.push(StartupItem {
                            name,
                            location,
                            kind: "LaunchAgent".to_string(),
                            risk: "low".to_string(),
                            signed: false,
                        });
                    }
                }
            }
        }
    }
    items
}

// ── Platform implementation: installed software ───────────────────────────────

#[cfg(windows)]
fn get_installed_software_impl() -> Vec<SoftwareItem> {
    use std::collections::HashSet;
    use winreg::{enums::*, RegKey};

    let paths = &[
        (
            HKEY_LOCAL_MACHINE,
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
        (
            HKEY_CURRENT_USER,
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            "SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        ),
    ];

    let mut items: Vec<SoftwareItem> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for &(hive, path) in paths {
        if let Ok(key) = RegKey::predef(hive).open_subkey(path) {
            for subkey_name in key.enum_keys().flatten() {
                if let Ok(sub) = key.open_subkey(&subkey_name) {
                    let name: String = sub.get_value("DisplayName").unwrap_or_default();
                    if name.is_empty() {
                        continue;
                    }
                    if !seen.insert(name.clone()) {
                        continue;
                    }
                    let version: String = sub.get_value("DisplayVersion").unwrap_or_default();
                    let publisher: String = sub.get_value("Publisher").unwrap_or_default();
                    items.push(SoftwareItem {
                        name,
                        version,
                        publisher,
                    });
                }
            }
        }
    }

    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    items
}

#[cfg(not(windows))]
fn get_installed_software_impl() -> Vec<SoftwareItem> {
    Vec::new()
}

// ── Platform implementation: drivers ─────────────────────────────────────────

#[cfg(windows)]
fn get_drivers_impl() -> Vec<DriverItem> {
    use std::process::Command;
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            r#"Get-WmiObject Win32_PnPSignedDriver | Where-Object { $_.DeviceName } | ForEach-Object { "$($_.DeviceName)|||$($_.DriverVersion)|||$($_.IsSigned)" }"#,
        ])
        .output();

    match output {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            let mut drivers: Vec<DriverItem> = text
                .lines()
                .filter_map(|line| {
                    let parts: Vec<&str> = line.splitn(3, "|||").collect();
                    if parts.len() < 3 {
                        return None;
                    }
                    let name = parts[0].trim().to_string();
                    if name.is_empty() {
                        return None;
                    }
                    let version = parts[1].trim().to_string();
                    let signed = parts[2].trim().eq_ignore_ascii_case("true");
                    Some(DriverItem { name, version, signed })
                })
                .collect();
            drivers.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            drivers.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
            drivers
        }
        Err(_) => Vec::new(),
    }
}

#[cfg(not(windows))]
fn get_drivers_impl() -> Vec<DriverItem> {
    Vec::new()
}

// ── Platform implementation: advanced info ────────────────────────────────────

#[cfg(windows)]
fn get_advanced_info_impl() -> AdvancedInfo {
    use winreg::{enums::*, RegKey};

    // Secure Boot — HKLM\SYSTEM\CurrentControlSet\Control\SecureBoot\State
    let secure_boot = {
        let key = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey("SYSTEM\\CurrentControlSet\\Control\\SecureBoot\\State");
        match key {
            Ok(k) => {
                let val: Result<u32, _> = k.get_value("UEFISecureBootEnabled");
                Some(val.map(|v| v != 0).unwrap_or(false))
            }
            Err(_) => Some(false),
        }
    };

    // TPM — query via PowerShell (Get-Tpm → fallback to WMI Win32_Tpm)
    let tpm_present = {
        use std::process::Command;
        let out = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                r#"try { (Get-Tpm -ErrorAction Stop).TpmPresent } catch { try { if (Get-WmiObject -Namespace root\cimv2\security\microsofttpm -Class Win32_Tpm -ErrorAction Stop) { 'True' } else { 'False' } } catch { 'False' } }"#,
            ])
            .output();
        out.ok().map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .to_lowercase()
                == "true"
        })
    };

    // Hypervisor / Virtualization — WMI Win32_ComputerSystem.HypervisorPresent
    let virtualization = {
        use std::process::Command;
        let out = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-WmiObject Win32_ComputerSystem).HypervisorPresent",
            ])
            .output();
        out.ok().map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .to_lowercase()
                == "true"
        })
    };

    AdvancedInfo {
        secure_boot,
        tpm_present,
        virtualization,
    }
}

#[cfg(not(windows))]
fn get_advanced_info_impl() -> AdvancedInfo {
    AdvancedInfo::default()
}

// ── Network connections helper ────────────────────────────────────────────────

/// Parse `netstat -ano` (Windows) / `netstat -an` (Unix) output.
fn parse_netstat_output(text: &str) -> Vec<NetConnection> {
    let mut connections = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        let proto = parts[0].to_uppercase();
        if proto.starts_with("TCP") && parts.len() >= 5 {
            connections.push(NetConnection {
                proto,
                local: parts[1].to_string(),
                remote: parts[2].to_string(),
                state: parts[3].to_string(),
                pid: parts[4].parse().ok(),
            });
        } else if proto.starts_with("UDP") && parts.len() >= 4 {
            connections.push(NetConnection {
                proto,
                local: parts[1].to_string(),
                remote: parts[2].to_string(),
                state: String::new(),
                pid: parts[3].parse().ok(),
            });
        }
    }
    connections
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sys_get_overview() -> SystemOverview {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_all();
    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_default();
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
    tokio::task::spawn_blocking(|| {
        use sysinfo::System;
        // Two-sample approach: first sample in new_all(), wait, then refresh
        // to get meaningful per-process CPU deltas.
        let mut sys = System::new_all();
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        sys.refresh_all();

        let mut procs: Vec<ProcessInfo> = sys
            .processes()
            .values()
            .map(|p| ProcessInfo {
                pid: usize::from(p.pid()) as u32,
                name: p.name().to_string_lossy().to_string(),
                cpu: p.cpu_usage(),
                mem: p.memory(),
                parent: p.parent().map(|pid| usize::from(pid) as u32),
            })
            .collect();

        procs.sort_by(|a, b| {
            b.cpu
                .partial_cmp(&a.cpu)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        procs
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn sys_kill_process(pid: u32) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        use sysinfo::{Pid, System};
        let spid = Pid::from(pid as usize);
        let sys = System::new_all();
        match sys.process(spid) {
            Some(proc) => Ok(proc.kill()),
            None => Err(format!("Process {} not found", pid)),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sys_get_disks() -> Vec<DiskInfo> {
    tokio::task::spawn_blocking(|| {
        use sysinfo::{DiskKind, Disks};
        let disks = Disks::new_with_refreshed_list();
        disks
            .iter()
            .map(|d| {
                let kind_str = match d.kind() {
                    DiskKind::SSD => "SSD",
                    DiskKind::HDD => "HDD",
                    _ => "Unknown",
                };
                DiskInfo {
                    name: d.name().to_string_lossy().to_string(),
                    mount: d.mount_point().to_string_lossy().to_string(),
                    total: d.total_space(),
                    available: d.available_space(),
                    kind: kind_str.to_string(),
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn sys_get_startup_items() -> Vec<StartupItem> {
    tokio::task::spawn_blocking(get_startup_items_impl)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn sys_get_network_connections() -> Vec<NetConnection> {
    tokio::task::spawn_blocking(|| {
        use std::process::Command;

        #[cfg(windows)]
        let output = Command::new("netstat").args(["-ano"]).output();
        #[cfg(not(windows))]
        let output = Command::new("netstat").args(["-an"]).output();

        match output {
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stdout);
                parse_netstat_output(&text)
            }
            Err(_) => Vec::new(),
        }
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn sys_get_installed_software() -> Vec<SoftwareItem> {
    tokio::task::spawn_blocking(get_installed_software_impl)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn sys_get_drivers() -> Vec<DriverItem> {
    tokio::task::spawn_blocking(get_drivers_impl)
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn sys_advanced_info() -> AdvancedInfo {
    tokio::task::spawn_blocking(get_advanced_info_impl)
        .await
        .unwrap_or_default()
}

// ── Background telemetry task ─────────────────────────────────────────────────

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
