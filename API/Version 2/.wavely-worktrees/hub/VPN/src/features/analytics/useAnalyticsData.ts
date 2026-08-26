import { useEffect, useRef, useState } from "react";
import { settingsStore } from "@/app/store";
import { EVENTS, subscribe } from "@/lib/ipc";
import { vpnApi } from "@/lib/ipc/vpn";
import type { Telemetry } from "@/types/system";
import type { VpnStats } from "@/types/vpn";

/** A single sampled performance point used by the analytics trend charts. */
export interface TrendPoint {
  ts: number;
  /** CPU load %. */
  cpu: number;
  /** Memory used %. */
  mem: number;
  /** Memory used in bytes. */
  memUsed: number;
  /** Download rate, bytes/s. */
  rx: number;
  /** Upload rate, bytes/s. */
  tx: number;
}

const MAX_POINTS = 300; // ~5 minutes at the backend's 1s cadence
const TREND_KEY = "analytics.trendHistory";
const PERSIST_EVERY_MS = 10_000;

function toPoint(t: Telemetry): TrendPoint {
  return {
    ts: t.ts,
    cpu: Math.round(t.cpuUsage),
    mem: t.memTotal ? Math.round((t.memUsed / t.memTotal) * 100) : 0,
    memUsed: t.memUsed,
    rx: t.netRxRate,
    tx: t.netTxRate,
  };
}

function isTrendPoint(v: unknown): v is TrendPoint {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.ts === "number" &&
    typeof p.cpu === "number" &&
    typeof p.mem === "number"
  );
}

/**
 * Rolling performance history sampled from the live `sys://telemetry` stream.
 *
 * Recent points are persisted via `@tauri-apps/plugin-store` so trends survive
 * navigation and app restarts. `restoredCount` reports how many points were
 * loaded from the previous session (the UI labels these as historical).
 */
export function useTrendHistory() {
  const [history, setHistory] = useState<TrendPoint[]>([]);
  const [restoredCount, setRestoredCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const buffer = useRef<TrendPoint[]>([]);
  const lastPersist = useRef(0);

  // Hydrate persisted history once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await settingsStore.get<TrendPoint[]>(TREND_KEY);
        if (!cancelled && Array.isArray(saved)) {
          const clean = saved.filter(isTrendPoint).slice(-MAX_POINTS);
          buffer.current = clean;
          setHistory(clean);
          setRestoredCount(clean.length);
        }
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to live telemetry after hydration.
  useEffect(() => {
    if (!hydrated) return;
    let unlisten: (() => void) | undefined;
    subscribe<Telemetry>(EVENTS.sysTelemetry, (event) => {
      const next = [...buffer.current, toPoint(event.payload)].slice(-MAX_POINTS);
      buffer.current = next;
      setHistory(next);

      const now = Date.now();
      if (now - lastPersist.current > PERSIST_EVERY_MS) {
        lastPersist.current = now;
        void persist(next);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
      // Flush the latest window on unmount.
      void persist(buffer.current);
    };
  }, [hydrated]);

  return { history, restoredCount, hydrated };
}

async function persist(points: TrendPoint[]) {
  try {
    await settingsStore.set(TREND_KEY, points.slice(-MAX_POINTS));
    await settingsStore.save();
  } catch {
    /* best-effort */
  }
}

/** A single VPN throughput sample (session only — not persisted). */
export interface VpnPoint {
  ts: number;
  rx: number;
  tx: number;
}

const VPN_MAX_POINTS = 120;

/**
 * Session VPN throughput history. Seeds from `vpn_get_stats`, then tracks the
 * live `vpn://stats` event. Not persisted — this is live session data only.
 */
export function useVpnStatsHistory() {
  const [latest, setLatest] = useState<VpnStats | null>(null);
  const [history, setHistory] = useState<VpnPoint[]>([]);
  const buffer = useRef<VpnPoint[]>([]);

  const push = (s: VpnStats) => {
    setLatest(s);
    const next = [
      ...buffer.current,
      { ts: Date.now(), rx: s.rxRate, tx: s.txRate },
    ].slice(-VPN_MAX_POINTS);
    buffer.current = next;
    setHistory(next);
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    vpnApi
      .getStats()
      .then((s) => {
        if (!cancelled) push(s);
      })
      .catch(() => {
        /* engine may not be ready */
      });

    subscribe<VpnStats>(EVENTS.vpnStats, (event) => push(event.payload)).then(
      (fn) => {
        unlisten = fn;
      },
    );

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { latest, history };
}
