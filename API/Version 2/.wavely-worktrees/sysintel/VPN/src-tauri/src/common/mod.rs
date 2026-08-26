//! Shared infrastructure for all Wavely engines.
//!
//! This module is owned by the foundation. It defines the cross-engine event
//! channel names and small shared helpers. Each engine module manages its own
//! state via `app.manage(...)` inside its `start()` function.

use std::time::{SystemTime, UNIX_EPOCH};

/// Event channel names emitted from Rust and subscribed to on the frontend.
///
/// Keep these in sync with `src/lib/ipc.ts` (`EVENTS`).
pub mod events {
    /// System Intelligence live telemetry tick (~1s).
    pub const SYS_TELEMETRY: &str = "sys://telemetry";

    /// Shield overall status changes.
    pub const SHIELD_STATUS: &str = "shield://status";
    /// Shield scan progress updates.
    pub const SHIELD_SCAN_PROGRESS: &str = "shield://scan-progress";
    /// Shield threat detected.
    pub const SHIELD_THREAT_FOUND: &str = "shield://threat-found";

    /// VPN connection status changes.
    pub const VPN_STATUS: &str = "vpn://status";
    /// VPN live throughput / handshake stats.
    pub const VPN_STATS: &str = "vpn://stats";
    /// VPN error notifications.
    pub const VPN_ERROR: &str = "vpn://error";
}

/// Current unix time in milliseconds.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
