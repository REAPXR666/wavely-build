//! Wavely Shield — antivirus / endpoint security engine.
//!
//! User-level (no kernel hooks) detection engine implementing:
//! - On-demand scanning (quick / full / arbitrary path) with `walkdir` +
//!   streaming SHA-256 (`sha2`) matched against a bundled hash blocklist that
//!   includes the EICAR test-file signature so detection is safely verifiable.
//! - Heuristics: double / suspicious executable extensions and obfuscated /
//!   base64 PowerShell in text files.
//! - Real-time protection: a `notify` watcher over Downloads / AppData / Temp /
//!   Startup that scans new & modified files while enabled.
//! - An app-data quarantine vault (XOR-obfuscated blobs + metadata JSON) with
//!   list / restore / delete, plus a persisted JSON threat log.
//!
//! This module is owned by the Shield agent. Known-malware (hash) hits are
//! auto-quarantined; heuristic hits are flagged (logged + surfaced) but left in
//! place to avoid touching legitimate user files.

use std::collections::HashSet;
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

use crate::common::{events, now_ms};

/// SHA-256 hashes of known-malicious files. Includes the EICAR anti-malware
/// test file so detection can be verified safely (drop an `eicar.com` into
/// Downloads with real-time protection on, or scan it on demand).
const HASH_BLOCKLIST: &[(&str, &str)] = &[
    (
        // EICAR Standard Anti-Virus Test File (68 bytes).
        "275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f",
        "EICAR-Test-File",
    ),
];

/// Rotating XOR key used to lightly obfuscate quarantined file contents at
/// rest. This is deliberately *not* real cryptography — it simply renders a
/// quarantined sample inert/non-executable on disk while keeping restore cheap.
const XOR_KEY: &[u8] = b"WavelyShieldVault!";

/// Cap individual files we are willing to hash so a full scan stays responsive.
const MAX_HASH_BYTES: u64 = 512 * 1024 * 1024;
/// Cap the number of files visited in a single scan.
const MAX_SCAN_FILES: usize = 40_000;
/// How many leading bytes of a text/script file we inspect for heuristics.
const MAX_HEURISTIC_BYTES: usize = 256 * 1024;

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_id(prefix: &str) -> String {
    let n = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{n}", now_ms())
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Backend state for the Shield engine (managed via Tauri state).
pub struct ShieldState {
    pub realtime_enabled: bool,
    /// Active real-time file-system watcher (kept alive while enabled).
    watcher: Option<notify::RecommendedWatcher>,
    /// Scan ids that have been requested to cancel.
    cancelled: Arc<Mutex<HashSet<String>>>,
    /// Timestamp (ms) of the last completed scan.
    last_scan: Option<u64>,
    /// `<app_data>/shield` — root for the threat log + quarantine vault.
    data_dir: PathBuf,
}

impl ShieldState {
    fn new(data_dir: PathBuf) -> Self {
        Self {
            realtime_enabled: false,
            watcher: None,
            cancelled: Arc::new(Mutex::new(HashSet::new())),
            last_scan: None,
            data_dir,
        }
    }
}

// ---------------------------------------------------------------------------
// DTOs (serde camelCase — mirrored in src/types/shield.ts)
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShieldStatus {
    pub realtime_enabled: bool,
    pub last_scan: Option<u64>,
    pub threats_found: u32,
    pub quarantined: u32,
    /// "user-level" for v1 (kernel hooks are out of scope).
    pub protection_level: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub id: String,
    pub scanned: u32,
    pub threats: u32,
    pub duration_ms: u64,
    /// True if the scan was cancelled before completing.
    pub cancelled: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThreatEntry {
    pub id: String,
    pub path: String,
    pub name: String,
    /// "low" | "medium" | "high" | "critical"
    pub severity: String,
    pub detected_at: u64,
    /// "quarantined" | "removed" | "allowed" | "detected"
    pub action: String,
    /// SHA-256 of the offending file (empty when not hashed).
    #[serde(default)]
    pub hash: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuarantineItem {
    pub id: String,
    pub original_path: String,
    pub name: String,
    pub quarantined_at: u64,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub threat: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    id: String,
    current: u32,
    total: u32,
    path: String,
}

// ---------------------------------------------------------------------------
// Detection engine
// ---------------------------------------------------------------------------

struct Detection {
    name: String,
    severity: String,
}

const EXECUTABLE_EXTS: &[&str] = &[
    "exe", "scr", "com", "pif", "bat", "cmd", "vbs", "vbe", "js", "jse", "wsf",
    "wsh", "hta", "ps1", "msi", "cpl", "jar",
];
const SUSPICIOUS_SCRIPT_EXTS: &[&str] =
    &["scr", "vbs", "ps1", "bat", "cmd", "js", "jse", "wsf", "hta", "pif"];
const TEXTUAL_EXTS: &[&str] = &["ps1", "bat", "cmd", "vbs", "js", "jse", "wsf", "hta", "txt"];

/// Detect whether `path` is a threat. Returns the highest-severity finding.
fn detect(path: &Path) -> Option<Detection> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();

    // 1) Known-malware by content hash (highest confidence).
    if let Some(hash) = hash_file(path) {
        if let Some((_, name)) = HASH_BLOCKLIST.iter().find(|(h, _)| *h == hash) {
            return Some(Detection {
                name: format!("{name} (signature match)"),
                severity: "critical".into(),
            });
        }
    }

    // 2) Obfuscated / base64 PowerShell or script content.
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if TEXTUAL_EXTS.contains(&ext.as_str()) {
        if let Some(name) = scan_text_heuristics(path) {
            return Some(Detection {
                name,
                severity: "high".into(),
            });
        }
    }

    // 3) Double extension masquerade (e.g. invoice.pdf.exe, photo.jpg.scr).
    let parts: Vec<&str> = file_name.split('.').collect();
    if parts.len() >= 3 {
        // The final extension is what Windows actually executes.
        if EXECUTABLE_EXTS.contains(&ext.as_str()) {
            // A non-executable "decoy" extension sits before the real one.
            let decoy = parts[parts.len() - 2];
            const DECOYS: &[&str] = &[
                "txt", "pdf", "doc", "docx", "jpg", "jpeg", "png", "gif", "xls",
                "xlsx", "zip", "rar", "mp3", "mp4",
            ];
            if DECOYS.contains(&decoy) {
                return Some(Detection {
                    name: "Heuristic.DoubleExtension".into(),
                    severity: "high".into(),
                });
            }
        }
    }

    // 4) Suspicious script / executable extension.
    if SUSPICIOUS_SCRIPT_EXTS.contains(&ext.as_str()) {
        return Some(Detection {
            name: format!("Heuristic.SuspiciousExtension ({ext})"),
            severity: "medium".into(),
        });
    }

    None
}

/// Inspect the leading bytes of a text file for common obfuscation markers.
fn scan_text_heuristics(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut buf = vec![0u8; MAX_HEURISTIC_BYTES];
    let n = file.read(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf[..n]).to_lowercase();

    const MARKERS: &[(&str, &str)] = &[
        ("frombase64string", "Heuristic.Base64Payload"),
        ("-encodedcommand", "Heuristic.EncodedCommand"),
        ("-enc ", "Heuristic.EncodedCommand"),
        ("invoke-expression", "Heuristic.InvokeExpression"),
        ("iex(", "Heuristic.InvokeExpression"),
        ("iex (", "Heuristic.InvokeExpression"),
        ("downloadstring", "Heuristic.RemoteDownload"),
        ("webclient", "Heuristic.RemoteDownload"),
        ("-windowstyle hidden", "Heuristic.HiddenWindow"),
        ("-w hidden", "Heuristic.HiddenWindow"),
    ];
    for (needle, label) in MARKERS {
        if text.contains(needle) {
            return Some((*label).into());
        }
    }

    // Long contiguous base64 run is a strong obfuscation signal.
    let mut run = 0usize;
    for b in text.bytes() {
        let is_b64 = b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=';
        if is_b64 {
            run += 1;
            if run >= 240 {
                return Some("Heuristic.LongBase64Blob".into());
            }
        } else {
            run = 0;
        }
    }
    None
}

/// Stream a file through SHA-256. Returns `None` for unreadable / oversized files.
fn hash_file(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_HASH_BYTES {
        return None;
    }
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buf).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Some(hex_encode(&hasher.finalize()))
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

// ---------------------------------------------------------------------------
// Persistence: threat log + quarantine vault
// ---------------------------------------------------------------------------

fn threat_log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("threat_log.json")
}

fn quarantine_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("quarantine")
}

fn read_threat_log(data_dir: &Path) -> Vec<ThreatEntry> {
    let path = threat_log_path(data_dir);
    let Ok(bytes) = fs::read(&path) else {
        return Vec::new();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn append_threat(data_dir: &Path, entry: &ThreatEntry) {
    let mut log = read_threat_log(data_dir);
    log.insert(0, entry.clone());
    log.truncate(1000);
    let _ = fs::create_dir_all(data_dir);
    if let Ok(json) = serde_json::to_vec_pretty(&log) {
        let _ = fs::write(threat_log_path(data_dir), json);
    }
}

fn list_quarantine_items(data_dir: &Path) -> Vec<QuarantineItem> {
    let dir = quarantine_dir(data_dir);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut items: Vec<QuarantineItem> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x == "json")
                .unwrap_or(false)
        })
        .filter_map(|e| fs::read(e.path()).ok())
        .filter_map(|bytes| serde_json::from_slice::<QuarantineItem>(&bytes).ok())
        .collect();
    items.sort_by(|a, b| b.quarantined_at.cmp(&a.quarantined_at));
    items
}

fn xor_bytes(data: &mut [u8]) {
    for (i, byte) in data.iter_mut().enumerate() {
        *byte ^= XOR_KEY[i % XOR_KEY.len()];
    }
}

/// Move `path` into the quarantine vault. Returns the created item on success.
fn quarantine_file(
    data_dir: &Path,
    path: &Path,
    detection: &Detection,
) -> std::io::Result<QuarantineItem> {
    let dir = quarantine_dir(data_dir);
    fs::create_dir_all(&dir)?;

    let id = next_id("q");
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let mut data = fs::read(path)?;
    xor_bytes(&mut data);
    fs::write(dir.join(format!("{id}.bin")), &data)?;

    let item = QuarantineItem {
        id: id.clone(),
        original_path: path.to_string_lossy().to_string(),
        name,
        quarantined_at: now_ms(),
        severity: detection.severity.clone(),
        threat: detection.name.clone(),
    };
    fs::write(
        dir.join(format!("{id}.json")),
        serde_json::to_vec_pretty(&item).unwrap_or_default(),
    )?;

    // Remove the original now that it is safely vaulted.
    fs::remove_file(path)?;
    Ok(item)
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

fn build_status(data_dir: &Path, realtime_enabled: bool, last_scan: Option<u64>) -> ShieldStatus {
    ShieldStatus {
        realtime_enabled,
        last_scan,
        threats_found: read_threat_log(data_dir).len() as u32,
        quarantined: list_quarantine_items(data_dir).len() as u32,
        protection_level: "user-level".into(),
    }
}

fn emit_status(app: &AppHandle, data_dir: &Path, realtime_enabled: bool, last_scan: Option<u64>) {
    let status = build_status(data_dir, realtime_enabled, last_scan);
    let _ = app.emit(events::SHIELD_STATUS, status);
}

// ---------------------------------------------------------------------------
// Target directory resolution
// ---------------------------------------------------------------------------

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn downloads_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join("Downloads"))
}

fn startup_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(|a| {
            PathBuf::from(a)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
                .join("Startup")
        })
    }
    #[cfg(not(windows))]
    {
        home_dir().map(|h| h.join(".config").join("autostart"))
    }
}

fn appdata_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        home_dir().map(|h| h.join(".config"))
    }
}

fn quick_scan_roots() -> Vec<PathBuf> {
    [downloads_dir(), Some(std::env::temp_dir()), startup_dir()]
        .into_iter()
        .flatten()
        .filter(|p| p.exists())
        .collect()
}

fn realtime_roots() -> Vec<(PathBuf, notify::RecursiveMode)> {
    use notify::RecursiveMode::{NonRecursive, Recursive};
    let mut roots = Vec::new();
    if let Some(d) = downloads_dir() {
        roots.push((d, Recursive));
    }
    if let Some(s) = startup_dir() {
        roots.push((s, Recursive));
    }
    // Temp + AppData are large/noisy: watch shallowly to stay light.
    roots.push((std::env::temp_dir(), NonRecursive));
    if let Some(a) = appdata_dir() {
        roots.push((a, NonRecursive));
    }
    roots.into_iter().filter(|(p, _)| p.exists()).collect()
}

// ---------------------------------------------------------------------------
// Core scan routine (runs on a blocking thread)
// ---------------------------------------------------------------------------

fn collect_files(roots: &[PathBuf], skip: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for root in roots {
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !e.path().starts_with(skip))
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                files.push(entry.into_path());
                if files.len() >= MAX_SCAN_FILES {
                    return files;
                }
            }
        }
    }
    files
}

fn run_scan(
    app: AppHandle,
    data_dir: PathBuf,
    cancelled: Arc<Mutex<HashSet<String>>>,
    roots: Vec<PathBuf>,
    id: String,
) -> ScanResult {
    let started = Instant::now();
    let skip = quarantine_dir(&data_dir);
    let files = collect_files(&roots, &skip);
    let total = files.len() as u32;
    let mut threats = 0u32;
    let mut was_cancelled = false;

    for (i, path) in files.iter().enumerate() {
        // Cooperative cancellation.
        if cancelled.lock().map(|c| c.contains(&id)).unwrap_or(false) {
            was_cancelled = true;
            break;
        }

        let current = (i + 1) as u32;
        if current == 1 || current == total || current % 8 == 0 {
            let _ = app.emit(
                events::SHIELD_SCAN_PROGRESS,
                ScanProgress {
                    id: id.clone(),
                    current,
                    total,
                    path: path.to_string_lossy().to_string(),
                },
            );
        }

        if let Some(detection) = detect(path) {
            handle_detection(&app, &data_dir, path, detection);
            threats += 1;
        }
    }

    // Final progress tick so the UI lands at 100%.
    let _ = app.emit(
        events::SHIELD_SCAN_PROGRESS,
        ScanProgress {
            id: id.clone(),
            current: total,
            total,
            path: String::new(),
        },
    );

    // Clear cancellation flag for this id.
    if let Ok(mut c) = cancelled.lock() {
        c.remove(&id);
    }

    ScanResult {
        id,
        scanned: total,
        threats,
        duration_ms: started.elapsed().as_millis() as u64,
        cancelled: was_cancelled,
    }
}

/// Log + (for known malware) quarantine a detected file, then emit events.
fn handle_detection(app: &AppHandle, data_dir: &Path, path: &Path, detection: Detection) {
    let hash = hash_file(path).unwrap_or_default();

    // Known-malware (critical) gets auto-quarantined; heuristic hits are flagged.
    let action = if detection.severity == "critical" {
        match quarantine_file(data_dir, path, &detection) {
            Ok(_) => "quarantined",
            Err(_) => "detected",
        }
    } else {
        "detected"
    };

    let entry = ThreatEntry {
        id: next_id("t"),
        path: path.to_string_lossy().to_string(),
        name: detection.name,
        severity: detection.severity,
        detected_at: now_ms(),
        action: action.into(),
        hash,
    };
    append_threat(data_dir, &entry);
    let _ = app.emit(events::SHIELD_THREAT_FOUND, entry);
}

/// Scan a single file (used by the real-time watcher).
fn scan_single(app: &AppHandle, data_dir: &Path, path: &Path) {
    if path.starts_with(quarantine_dir(data_dir)) || !path.is_file() {
        return;
    }
    if let Some(detection) = detect(path) {
        handle_detection(app, data_dir, path, detection);
        emit_status(app, data_dir, true, None);
    }
}

// ---------------------------------------------------------------------------
// Real-time watcher
// ---------------------------------------------------------------------------

fn start_watcher(app: AppHandle, data_dir: PathBuf) -> Option<notify::RecommendedWatcher> {
    use notify::{Event, EventKind, Watcher};

    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })
    .ok()?;

    for (root, mode) in realtime_roots() {
        let _ = watcher.watch(&root, mode);
    }

    // Drain events on a dedicated thread; exits when the watcher (and its
    // sender) is dropped, i.e. when real-time protection is turned off.
    let worker_app = app.clone();
    let worker_dir = data_dir.clone();
    std::thread::spawn(move || {
        while let Ok(event) = rx.recv() {
            let Ok(event) = event else { continue };
            if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                continue;
            }
            for path in event.paths {
                scan_single(&worker_app, &worker_dir, &path);
            }
        }
    });

    Some(watcher)
}

// ---------------------------------------------------------------------------
// Commands (contract)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn shield_get_status(
    state: tauri::State<'_, Mutex<ShieldState>>,
) -> Result<ShieldStatus, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(build_status(
        &guard.data_dir,
        guard.realtime_enabled,
        guard.last_scan,
    ))
}

#[tauri::command]
pub async fn shield_set_realtime(
    enabled: bool,
    app: AppHandle,
    state: tauri::State<'_, Mutex<ShieldState>>,
) -> Result<(), String> {
    let data_dir = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard.data_dir.clone()
    };

    if enabled {
        let watcher = start_watcher(app.clone(), data_dir.clone());
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.watcher = watcher;
        guard.realtime_enabled = guard.watcher.is_some();
    } else {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.watcher = None; // dropping the watcher stops the worker thread
        guard.realtime_enabled = false;
    }

    let (rt, last) = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        (guard.realtime_enabled, guard.last_scan)
    };
    emit_status(&app, &data_dir, rt, last);
    Ok(())
}

async fn scan_roots(
    app: AppHandle,
    state: tauri::State<'_, Mutex<ShieldState>>,
    roots: Vec<PathBuf>,
) -> Result<ScanResult, String> {
    let (data_dir, cancelled) = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        (guard.data_dir.clone(), guard.cancelled.clone())
    };
    let id = next_id("scan");

    let app_for_scan = app.clone();
    let data_for_scan = data_dir.clone();
    let result = tokio::task::spawn_blocking(move || {
        run_scan(app_for_scan, data_for_scan, cancelled, roots, id)
    })
    .await
    .map_err(|e| e.to_string())?;

    // Record completion time + push fresh status.
    let last = now_ms();
    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.last_scan = Some(last);
    }
    let rt = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard.realtime_enabled
    };
    emit_status(&app, &data_dir, rt, Some(last));
    Ok(result)
}

#[tauri::command]
pub async fn shield_quick_scan(
    app: AppHandle,
    state: tauri::State<'_, Mutex<ShieldState>>,
) -> Result<ScanResult, String> {
    scan_roots(app, state, quick_scan_roots()).await
}

#[tauri::command]
pub async fn shield_full_scan(
    app: AppHandle,
    state: tauri::State<'_, Mutex<ShieldState>>,
) -> Result<ScanResult, String> {
    let roots = home_dir().into_iter().filter(|p| p.exists()).collect();
    scan_roots(app, state, roots).await
}

#[tauri::command]
pub async fn shield_scan_path(
    path: String,
    app: AppHandle,
    state: tauri::State<'_, Mutex<ShieldState>>,
) -> Result<ScanResult, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    scan_roots(app, state, vec![p]).await
}

#[tauri::command]
pub async fn shield_cancel_scan(
    id: String,
    state: tauri::State<'_, Mutex<ShieldState>>,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    guard
        .cancelled
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id);
    Ok(())
}

#[tauri::command]
pub async fn shield_list_quarantine(
    state: tauri::State<'_, Mutex<ShieldState>>,
) -> Result<Vec<QuarantineItem>, String> {
    let data_dir = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard.data_dir.clone()
    };
    Ok(list_quarantine_items(&data_dir))
}

#[tauri::command]
pub async fn shield_quarantine_restore(
    id: String,
    app: AppHandle,
    state: tauri::State<'_, Mutex<ShieldState>>,
) -> Result<(), String> {
    let (data_dir, rt, last) = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        (guard.data_dir.clone(), guard.realtime_enabled, guard.last_scan)
    };
    let dir = quarantine_dir(&data_dir);
    let meta_path = dir.join(format!("{id}.json"));
    let bin_path = dir.join(format!("{id}.bin"));

    let bytes = fs::read(&meta_path).map_err(|e| e.to_string())?;
    let item: QuarantineItem = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;

    let mut data = fs::read(&bin_path).map_err(|e| e.to_string())?;
    xor_bytes(&mut data); // reverse the obfuscation
    let original = PathBuf::from(&item.original_path);
    if let Some(parent) = original.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&original, &data).map_err(|e| e.to_string())?;

    let _ = fs::remove_file(&bin_path);
    let _ = fs::remove_file(&meta_path);

    emit_status(&app, &data_dir, rt, last);
    Ok(())
}

#[tauri::command]
pub async fn shield_quarantine_delete(
    id: String,
    app: AppHandle,
    state: tauri::State<'_, Mutex<ShieldState>>,
) -> Result<(), String> {
    let (data_dir, rt, last) = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        (guard.data_dir.clone(), guard.realtime_enabled, guard.last_scan)
    };
    let dir = quarantine_dir(&data_dir);
    let _ = fs::remove_file(dir.join(format!("{id}.bin")));
    fs::remove_file(dir.join(format!("{id}.json"))).map_err(|e| e.to_string())?;
    emit_status(&app, &data_dir, rt, last);
    Ok(())
}

#[tauri::command]
pub async fn shield_get_threat_log(
    state: tauri::State<'_, Mutex<ShieldState>>,
) -> Result<Vec<ThreatEntry>, String> {
    let data_dir = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard.data_dir.clone()
    };
    Ok(read_threat_log(&data_dir))
}

#[tauri::command]
pub async fn shield_update_rules() -> Result<u32, String> {
    // Definitions are bundled in-binary for v1; report the active signature count.
    Ok(HASH_BLOCKLIST.len() as u32)
}

/// Initialize Shield engine state. The real-time watcher is started lazily
/// when the user enables protection via `shield_set_realtime`.
pub fn start(app: &AppHandle) {
    let data_dir = app
        .path()
        .app_data_dir()
        .map(|d| d.join("shield"))
        .unwrap_or_else(|_| std::env::temp_dir().join("wavely-shield"));
    let _ = fs::create_dir_all(&data_dir);
    app.manage(Mutex::new(ShieldState::new(data_dir)));
}
