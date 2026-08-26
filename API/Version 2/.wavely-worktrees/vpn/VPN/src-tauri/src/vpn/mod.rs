//! Wavely VPN Core — WireGuard tunnel engine.
//!
//! Implements the VPN command surface: a curated demo server list, a real
//! WireGuard `.conf` parser/validator, connection state management, a live
//! throughput emitter (`vpn://stats`) and status broadcaster (`vpn://status`),
//! plus kill-switch / DNS settings.
//!
//! Connection modes:
//! - `"real"`  — a system WireGuard CLI was detected and the tunnel was brought
//!   up from an imported config (best-effort; stats read from `wg show`).
//! - `"demo"`  — no CLI / no config: a clearly-labeled simulated tunnel with
//!   realistic synthetic throughput. The demo mode never touches the OS
//!   firewall or network configuration.

use serde::Serialize;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::common::{events, now_ms};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Parsed + validated summary of an imported WireGuard configuration.
#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WgConfigSummary {
    pub interface_address: Option<String>,
    pub dns: Vec<String>,
    pub peer_public_key: Option<String>,
    pub endpoint: Option<String>,
    pub allowed_ips: Vec<String>,
}

/// Backend state for the VPN engine (managed via Tauri state).
pub struct VpnState {
    pub status: VpnStatus,
    /// DNS servers configured for leak protection.
    pub dns: Vec<String>,
    /// Last successfully imported WireGuard config (if any).
    pub config: Option<WgConfigSummary>,
    /// Raw imported config text (kept for a best-effort real tunnel).
    pub raw_config: Option<String>,
    /// Latest throughput sample.
    pub stats: VpnStats,
    /// Bumped on every connect; the stats task stops when it no longer matches.
    pub generation: u64,
    /// Interface name of an active real tunnel (for teardown).
    pub real_iface: Option<String>,
}

impl Default for VpnState {
    fn default() -> Self {
        Self {
            status: VpnStatus {
                mode: "demo".into(),
                ..Default::default()
            },
            dns: vec!["1.1.1.1".into(), "1.0.0.1".into()],
            config: None,
            raw_config: None,
            stats: VpnStats::default(),
            generation: 0,
            real_iface: None,
        }
    }
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
// Tiny PRNG (avoids pulling in the `rand` crate for synthetic telemetry).
// ---------------------------------------------------------------------------

#[inline]
fn xorshift(state: &mut u64) -> u64 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    *state = x;
    x
}

/// Uniform value in `[min, max]`.
#[inline]
fn rand_range(state: &mut u64, min: u64, max: u64) -> u64 {
    if max <= min {
        return min;
    }
    min + xorshift(state) % (max - min + 1)
}

// ---------------------------------------------------------------------------
// Curated server list
// ---------------------------------------------------------------------------

const SERVER_SEED: &[(&str, &str, &str, &str, u32)] = &[
    // id, country, city, flag, base ping (ms)
    ("uk-lon", "United Kingdom", "London", "🇬🇧", 18),
    ("us-nyc", "United States", "New York", "🇺🇸", 78),
    ("us-sfo", "United States", "San Francisco", "🇺🇸", 142),
    ("de-fra", "Germany", "Frankfurt", "🇩🇪", 24),
    ("nl-ams", "Netherlands", "Amsterdam", "🇳🇱", 21),
    ("fr-par", "France", "Paris", "🇫🇷", 27),
    ("se-sto", "Sweden", "Stockholm", "🇸🇪", 33),
    ("ch-zrh", "Switzerland", "Zurich", "🇨🇭", 29),
    ("jp-tyo", "Japan", "Tokyo", "🇯🇵", 198),
    ("sg-sin", "Singapore", "Singapore", "🇸🇬", 176),
    ("au-syd", "Australia", "Sydney", "🇦🇺", 256),
    ("ca-tor", "Canada", "Toronto", "🇨🇦", 88),
];

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn vpn_get_status(state: State<'_, Mutex<VpnState>>) -> Result<VpnStatus, String> {
    Ok(state.lock().map_err(|e| e.to_string())?.status.clone())
}

#[tauri::command]
pub async fn vpn_get_stats(state: State<'_, Mutex<VpnState>>) -> Result<VpnStats, String> {
    Ok(state.lock().map_err(|e| e.to_string())?.stats.clone())
}

#[tauri::command]
pub async fn vpn_list_servers() -> Vec<VpnServer> {
    let mut seed = now_ms() | 1;
    SERVER_SEED
        .iter()
        .map(|(id, country, city, flag, base_ping)| {
            // Add small jitter on top of the base latency, and a synthetic load.
            let jitter = rand_range(&mut seed, 0, 14) as i64 - 6;
            let ping = (*base_ping as i64 + jitter).max(4) as u32;
            let load = rand_range(&mut seed, 8, 96) as u8;
            VpnServer {
                id: (*id).into(),
                country: (*country).into(),
                city: (*city).into(),
                flag: (*flag).into(),
                ping_ms: ping,
                load,
                demo: true,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn vpn_import_config(
    config: String,
    state: State<'_, Mutex<VpnState>>,
) -> Result<String, String> {
    let summary = parse_wg_config(&config)?;

    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.config = Some(summary.clone());
    guard.raw_config = Some(config);
    if !summary.dns.is_empty() {
        guard.dns = summary.dns.clone();
    }
    drop(guard);

    let peers = if summary.peer_public_key.is_some() { 1 } else { 0 };
    let endpoint = summary.endpoint.clone().unwrap_or_else(|| "n/a".into());
    let dns = if summary.dns.is_empty() {
        "default".to_string()
    } else {
        summary.dns.join(", ")
    };
    Ok(format!(
        "Imported WireGuard tunnel → endpoint {endpoint} ({peers} peer, DNS {dns})"
    ))
}

#[tauri::command]
pub async fn vpn_connect(
    server_id: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<VpnState>>,
) -> Result<VpnStatus, String> {
    // Decide mode + (best-effort) bring up a real tunnel.
    let (mode, iface) = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        let has_config = guard.raw_config.is_some();
        let raw = guard.raw_config.clone();
        drop(guard);

        if has_config && wg_cli_available() {
            match try_real_up(raw.as_deref().unwrap_or_default()) {
                Ok(iface) => ("real".to_string(), Some(iface)),
                Err(err) => {
                    // Surface the failure, then fall back to a labeled demo tunnel.
                    let _ = app.emit(
                        events::VPN_ERROR,
                        format!("Real tunnel unavailable ({err}); using demo mode"),
                    );
                    ("demo".to_string(), None)
                }
            }
        } else {
            ("demo".to_string(), None)
        }
    };

    let status = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.generation = guard.generation.wrapping_add(1);
        let now = now_ms();
        guard.status = VpnStatus {
            connected: true,
            server_id: server_id.or_else(|| Some("uk-lon".into())),
            kill_switch: guard.status.kill_switch,
            mode,
            since: Some(now),
        };
        guard.real_iface = iface;
        guard.stats = VpnStats {
            last_handshake: Some(now),
            ..Default::default()
        };
        guard.status.clone()
    };

    let _ = app.emit(events::VPN_STATUS, status.clone());
    spawn_stats_task(app);
    Ok(status)
}

#[tauri::command]
pub async fn vpn_disconnect(
    app: AppHandle,
    state: State<'_, Mutex<VpnState>>,
) -> Result<(), String> {
    let status = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        // Best-effort teardown of a real tunnel.
        if let Some(iface) = guard.real_iface.take() {
            try_real_down(&iface);
        }
        guard.generation = guard.generation.wrapping_add(1);
        let mode = guard.status.mode.clone();
        guard.status = VpnStatus {
            connected: false,
            server_id: None,
            kill_switch: guard.status.kill_switch,
            mode,
            since: None,
        };
        guard.stats = VpnStats::default();
        guard.status.clone()
    };

    let _ = app.emit(events::VPN_STATUS, status);
    Ok(())
}

#[tauri::command]
pub async fn vpn_set_killswitch(
    enabled: bool,
    app: AppHandle,
    state: State<'_, Mutex<VpnState>>,
) -> Result<(), String> {
    // NOTE: demo mode stores the preference only — it does NOT reconfigure the
    // OS firewall. A real implementation would install WFP/iptables rules here.
    let status = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.status.kill_switch = enabled;
        guard.status.clone()
    };
    let _ = app.emit(events::VPN_STATUS, status);
    Ok(())
}

#[tauri::command]
pub async fn vpn_set_dns(
    servers: Vec<String>,
    state: State<'_, Mutex<VpnState>>,
) -> Result<(), String> {
    // Validate each entry looks like an IP address (best-effort).
    for s in &servers {
        if !looks_like_ip(s) {
            return Err(format!("'{s}' is not a valid IP address"));
        }
    }
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.dns = servers;
    Ok(())
}

// ---------------------------------------------------------------------------
// Background throughput emitter
// ---------------------------------------------------------------------------

/// Spawns the per-second `vpn://stats` emitter for the current connection.
///
/// In `real` mode it tries to read counters from `wg show <iface> dump`; if
/// that fails (or in demo mode) it produces realistic synthetic throughput.
fn spawn_stats_task(app: AppHandle) {
    let (my_gen, mut real_iface) = match app.try_state::<Mutex<VpnState>>() {
        Some(state) => match state.lock() {
            Ok(g) => (g.generation, g.real_iface.clone()),
            Err(_) => return,
        },
        None => return,
    };

    tokio::spawn(async move {
        let mut seed = now_ms() | 1;
        // Smoothed synthetic rates (bytes/sec).
        let mut rx_rate = rand_range(&mut seed, 400_000, 1_500_000);
        let mut tx_rate = rand_range(&mut seed, 80_000, 300_000);
        let mut rx_total: u64 = 0;
        let mut tx_total: u64 = 0;
        let connected_at = now_ms();

        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;

            let state = match app.try_state::<Mutex<VpnState>>() {
                Some(s) => s,
                None => break,
            };

            // Stop if this connection has been superseded or torn down.
            {
                let guard = match state.lock() {
                    Ok(g) => g,
                    Err(_) => break,
                };
                if !guard.status.connected || guard.generation != my_gen {
                    break;
                }
                if real_iface.is_none() {
                    real_iface = guard.real_iface.clone();
                }
            }

            // Prefer real counters when a real tunnel is up.
            let mut sample: Option<VpnStats> = None;
            if let Some(iface) = real_iface.as_deref() {
                if let Some((rx, tx, hs)) = read_wg_dump(iface) {
                    let rrate = rx.saturating_sub(rx_total);
                    let trate = tx.saturating_sub(tx_total);
                    rx_total = rx;
                    tx_total = tx;
                    sample = Some(VpnStats {
                        rx_bytes: rx,
                        tx_bytes: tx,
                        rx_rate: rrate,
                        tx_rate: trate,
                        last_handshake: hs.or(Some(connected_at)),
                    });
                }
            }

            let stats = sample.unwrap_or_else(|| {
                // Random-walk the rates for a lively-but-plausible graph.
                rx_rate = step_rate(&mut seed, rx_rate, 120_000, 6_000_000);
                tx_rate = step_rate(&mut seed, tx_rate, 30_000, 1_200_000);
                rx_total = rx_total.saturating_add(rx_rate);
                tx_total = tx_total.saturating_add(tx_rate);

                // Simulate a fresh handshake roughly every ~25s.
                let elapsed = now_ms().saturating_sub(connected_at) / 1000;
                let last_handshake = Some(connected_at + (elapsed / 25) * 25_000);

                VpnStats {
                    rx_bytes: rx_total,
                    tx_bytes: tx_total,
                    rx_rate,
                    tx_rate,
                    last_handshake,
                }
            });

            // Persist + broadcast.
            if let Ok(mut guard) = state.lock() {
                if !guard.status.connected || guard.generation != my_gen {
                    break;
                }
                guard.stats = stats.clone();
            }
            let _ = app.emit(events::VPN_STATS, stats);
        }
    });
}

/// Nudge a rate up/down within bounds for a natural-looking series.
fn step_rate(seed: &mut u64, current: u64, min: u64, max: u64) -> u64 {
    let span = (max - min).max(1);
    let delta = rand_range(seed, 0, span / 8) as i64 - (span / 16) as i64;
    let next = current as i64 + delta;
    next.clamp(min as i64, max as i64) as u64
}

// ---------------------------------------------------------------------------
// WireGuard config parsing + validation
// ---------------------------------------------------------------------------

/// Parse and validate a WireGuard `.conf`. Returns a structured summary or a
/// human-readable error describing the first problem found.
pub fn parse_wg_config(text: &str) -> Result<WgConfigSummary, String> {
    let mut section: Option<String> = None;
    let mut have_interface = false;
    let mut have_peer = false;

    let mut private_key: Option<String> = None;
    let mut summary = WgConfigSummary::default();

    for (lineno, raw) in text.lines().enumerate() {
        let line = strip_comment(raw).trim();
        if line.is_empty() {
            continue;
        }

        if let Some(rest) = line.strip_prefix('[') {
            let name = rest.strip_suffix(']').ok_or_else(|| {
                format!("Line {}: malformed section header '{line}'", lineno + 1)
            })?;
            let name = name.trim().to_ascii_lowercase();
            match name.as_str() {
                "interface" => have_interface = true,
                "peer" => have_peer = true,
                other => return Err(format!("Line {}: unknown section '[{other}]'", lineno + 1)),
            }
            section = Some(name);
            continue;
        }

        let (key, value) = line
            .split_once('=')
            .ok_or_else(|| format!("Line {}: expected 'Key = Value'", lineno + 1))?;
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim().to_string();

        match (section.as_deref(), key.as_str()) {
            (Some("interface"), "privatekey") => private_key = Some(value),
            (Some("interface"), "address") => {
                summary.interface_address = Some(value);
            }
            (Some("interface"), "dns") => {
                summary.dns = value
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
            (Some("peer"), "publickey") => summary.peer_public_key = Some(value),
            (Some("peer"), "endpoint") => summary.endpoint = Some(value),
            (Some("peer"), "allowedips") => {
                summary.allowed_ips = value
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
            (None, _) => {
                return Err(format!(
                    "Line {}: key '{key}' outside of any section",
                    lineno + 1
                ))
            }
            _ => { /* ignore other recognized-but-unused keys */ }
        }
    }

    // Structural validation.
    if !have_interface {
        return Err("Missing required [Interface] section".into());
    }
    if !have_peer {
        return Err("Missing required [Peer] section".into());
    }
    match private_key.as_deref() {
        Some(k) if is_wg_key(k) => {}
        Some(_) => return Err("[Interface] PrivateKey is not a valid 32-byte base64 key".into()),
        None => return Err("[Interface] is missing PrivateKey".into()),
    }
    match summary.peer_public_key.as_deref() {
        Some(k) if is_wg_key(k) => {}
        Some(_) => return Err("[Peer] PublicKey is not a valid 32-byte base64 key".into()),
        None => return Err("[Peer] is missing PublicKey".into()),
    }
    match summary.endpoint.as_deref() {
        Some(e) if is_valid_endpoint(e) => {}
        Some(_) => return Err("[Peer] Endpoint must be host:port".into()),
        None => return Err("[Peer] is missing Endpoint".into()),
    }

    Ok(summary)
}

fn strip_comment(line: &str) -> &str {
    match line.find('#') {
        Some(i) => &line[..i],
        None => line,
    }
}

/// A WireGuard key is 32 bytes base64-encoded: 44 chars ending in '='.
fn is_wg_key(s: &str) -> bool {
    s.len() == 44
        && s.ends_with('=')
        && s[..43]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=')
}

/// Validate a `host:port` endpoint (host may be a domain, IPv4, or [IPv6]).
fn is_valid_endpoint(s: &str) -> bool {
    let (host, port) = match s.rsplit_once(':') {
        Some(v) => v,
        None => return false,
    };
    if host.is_empty() {
        return false;
    }
    match port.parse::<u32>() {
        Ok(p) => (1..=65535).contains(&p),
        Err(_) => false,
    }
}

/// Loose IPv4/IPv6 check sufficient for DNS-entry validation.
fn looks_like_ip(s: &str) -> bool {
    let s = s.trim();
    if s.is_empty() {
        return false;
    }
    if s.contains(':') {
        // IPv6-ish: hex groups + colons.
        return s
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == ':' || c == '%');
    }
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 4
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.parse::<u8>().is_ok())
}

// ---------------------------------------------------------------------------
// Best-effort real WireGuard CLI integration
// ---------------------------------------------------------------------------

/// Returns true if a `wg` binary is available on PATH.
fn wg_cli_available() -> bool {
    Command::new("wg")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Best-effort bring-up of a real tunnel from raw config. Returns the interface
/// name on success. Any failure leaves the system untouched and falls back to
/// demo mode (handled by the caller).
fn try_real_up(raw_config: &str) -> Result<String, String> {
    use std::io::Write;

    let iface = "wavely";
    let mut path = std::env::temp_dir();
    path.push(format!("{iface}.conf"));
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(raw_config.as_bytes())
        .map_err(|e| e.to_string())?;

    let path_str = path.to_string_lossy().to_string();

    #[cfg(windows)]
    let result = Command::new("wireguard.exe")
        .args(["/installtunnelservice", &path_str])
        .output();

    #[cfg(not(windows))]
    let result = Command::new("wg-quick").args(["up", &path_str]).output();

    match result {
        Ok(o) if o.status.success() => Ok(iface.to_string()),
        Ok(o) => Err(String::from_utf8_lossy(&o.stderr).trim().to_string()),
        Err(e) => Err(e.to_string()),
    }
}

/// Best-effort teardown of a real tunnel. Errors are ignored.
fn try_real_down(iface: &str) {
    #[cfg(windows)]
    let _ = Command::new("wireguard.exe")
        .args(["/uninstalltunnelservice", iface])
        .output();

    #[cfg(not(windows))]
    let _ = Command::new("wg-quick").args(["down", iface]).output();
}

/// Parse `wg show <iface> dump` for cumulative rx/tx bytes and last handshake.
///
/// The peer line columns are: pubkey, psk, endpoint, allowed-ips,
/// latest-handshake (unix secs), rx-bytes, tx-bytes, keepalive.
fn read_wg_dump(iface: &str) -> Option<(u64, u64, Option<u64>)> {
    let out = Command::new("wg")
        .args(["show", iface, "dump"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut rx = 0u64;
    let mut tx = 0u64;
    let mut handshake: Option<u64> = None;
    // Skip the first line (interface), sum across peer lines.
    for line in text.lines().skip(1) {
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() >= 7 {
            if let Ok(h) = cols[4].parse::<u64>() {
                if h > 0 {
                    handshake = Some(h * 1000);
                }
            }
            rx += cols[5].parse::<u64>().unwrap_or(0);
            tx += cols[6].parse::<u64>().unwrap_or(0);
        }
    }
    Some((rx, tx, handshake))
}

/// Initialize VPN engine state. Background tasks are spawned per-connection.
pub fn start(app: &AppHandle) {
    app.manage(Mutex::new(VpnState::default()));
}
