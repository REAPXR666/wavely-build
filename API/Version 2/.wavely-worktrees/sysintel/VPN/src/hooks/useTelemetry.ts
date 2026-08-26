import { useEffect, useRef, useState } from "react";
import { EVENTS, subscribe } from "@/lib/ipc";
import type { Telemetry } from "@/types/system";

const MAX_POINTS = 60;

/**
 * Subscribes to the live `sys://telemetry` stream emitted by the backend.
 * Returns the latest sample plus a rolling history window for charts.
 */
export function useTelemetry() {
  const [latest, setLatest] = useState<Telemetry | null>(null);
  const [history, setHistory] = useState<Telemetry[]>([]);
  const buffer = useRef<Telemetry[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    subscribe<Telemetry>(EVENTS.sysTelemetry, (event) => {
      const sample = event.payload;
      setLatest(sample);
      buffer.current = [...buffer.current, sample].slice(-MAX_POINTS);
      setHistory(buffer.current);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  return { latest, history };
}
