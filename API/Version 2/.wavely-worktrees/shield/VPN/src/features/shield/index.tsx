import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  Bug,
  Clock,
  FolderSearch,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { StatusDot } from "@/components/ui/StatusDot";
import { Tooltip } from "@/components/ui/Tooltip";
import { EVENTS, subscribe } from "@/lib/ipc";
import { shieldApi } from "@/lib/ipc/shield";
import type {
  ScanProgress,
  ScanResult,
  ShieldStatus,
  ThreatEntry,
} from "@/types/shield";
import { absoluteTime, relativeTime } from "./lib";
import { ThreatLogTable } from "./ThreatLogTable";
import { QuarantineList } from "./QuarantineList";

type ScanKind = "quick" | "full" | "custom";

interface ScanRun {
  kind: ScanKind;
  progress: ScanProgress | null;
}

const SCAN_LABELS: Record<ScanKind, string> = {
  quick: "Quick scan",
  full: "Full scan",
  custom: "Custom scan",
};

export function ShieldPage() {
  const qc = useQueryClient();

  const status = useQuery({
    queryKey: ["shield", "status"],
    queryFn: shieldApi.getStatus,
  });
  const threats = useQuery({
    queryKey: ["shield", "threatLog"],
    queryFn: shieldApi.getThreatLog,
  });
  const quarantine = useQuery({
    queryKey: ["shield", "quarantine"],
    queryFn: shieldApi.listQuarantine,
  });

  const [scan, setScan] = useState<ScanRun | null>(null);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [pendingQuarantineId, setPendingQuarantineId] = useState<string | null>(null);
  // Live id of the in-flight scan (captured from progress events) for cancel.
  const activeScanId = useRef<string | null>(null);

  // --- Live event subscriptions ------------------------------------------
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    subscribe<ScanProgress>(EVENTS.shieldScanProgress, (e) => {
      activeScanId.current = e.payload.id;
      setScan((prev) => (prev ? { ...prev, progress: e.payload } : prev));
    }).then((fn) => unsubs.push(fn));

    subscribe<ThreatEntry>(EVENTS.shieldThreatFound, (e) => {
      const t = e.payload;
      toast.error(`Threat detected: ${t.name}`, {
        description: t.path,
        icon: t.severity === "critical" ? "🛑" : "⚠️",
      });
      qc.invalidateQueries({ queryKey: ["shield", "threatLog"] });
      qc.invalidateQueries({ queryKey: ["shield", "quarantine"] });
    }).then((fn) => unsubs.push(fn));

    subscribe<ShieldStatus>(EVENTS.shieldStatus, (e) => {
      qc.setQueryData(["shield", "status"], e.payload);
    }).then((fn) => unsubs.push(fn));

    return () => unsubs.forEach((fn) => fn());
  }, [qc]);

  // --- Mutations ----------------------------------------------------------
  const realtime = useMutation({
    mutationFn: (enabled: boolean) => shieldApi.setRealtime(enabled),
    onSuccess: (_, enabled) => {
      qc.invalidateQueries({ queryKey: ["shield", "status"] });
      toast[enabled ? "success" : "message"](
        enabled ? "Real-time protection enabled" : "Real-time protection paused",
      );
    },
    onError: (err) => toast.error(`Could not update protection: ${String(err)}`),
  });

  const restore = useMutation({
    mutationFn: (id: string) => shieldApi.quarantineRestore(id),
    onMutate: (id) => setPendingQuarantineId(id),
    onSuccess: () => {
      toast.success("File restored to its original location");
      qc.invalidateQueries({ queryKey: ["shield", "quarantine"] });
      qc.invalidateQueries({ queryKey: ["shield", "status"] });
    },
    onError: (err) => toast.error(`Restore failed: ${String(err)}`),
    onSettled: () => setPendingQuarantineId(null),
  });

  const remove = useMutation({
    mutationFn: (id: string) => shieldApi.quarantineDelete(id),
    onMutate: (id) => setPendingQuarantineId(id),
    onSuccess: () => {
      toast.success("Quarantined file deleted permanently");
      qc.invalidateQueries({ queryKey: ["shield", "quarantine"] });
      qc.invalidateQueries({ queryKey: ["shield", "status"] });
    },
    onError: (err) => toast.error(`Delete failed: ${String(err)}`),
    onSettled: () => setPendingQuarantineId(null),
  });

  // --- Scan orchestration -------------------------------------------------
  async function runScan(kind: ScanKind) {
    if (scan) return;
    let promise: Promise<ScanResult>;
    if (kind === "quick") {
      promise = shieldApi.quickScan();
    } else if (kind === "full") {
      promise = shieldApi.fullScan();
    } else {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select a folder to scan",
      });
      if (typeof selected !== "string") return; // cancelled
      promise = shieldApi.scanPath(selected);
    }

    setScan({ kind, progress: null });
    setLastResult(null);
    activeScanId.current = null;

    try {
      const result = await promise;
      setLastResult(result);
      if (result.cancelled) {
        toast.message("Scan cancelled", {
          description: `${result.scanned} files were checked before stopping.`,
        });
      } else if (result.threats > 0) {
        toast.warning(
          `${SCAN_LABELS[kind]} complete — ${result.threats} threat${result.threats === 1 ? "" : "s"} found`,
        );
      } else {
        toast.success(`${SCAN_LABELS[kind]} complete — no threats found`);
      }
    } catch (err) {
      toast.error(`Scan failed: ${String(err)}`);
    } finally {
      setScan(null);
      activeScanId.current = null;
      qc.invalidateQueries({ queryKey: ["shield", "status"] });
      qc.invalidateQueries({ queryKey: ["shield", "threatLog"] });
      qc.invalidateQueries({ queryKey: ["shield", "quarantine"] });
    }
  }

  function cancelScan() {
    const id = activeScanId.current;
    if (id) shieldApi.cancelScan(id).catch(() => {});
  }

  const updateDefs = useMutation({
    mutationFn: () => shieldApi.updateRules(),
    onSuccess: (count) =>
      toast.success(`Definitions up to date — ${count} active signature${count === 1 ? "" : "s"}`),
    onError: (err) => toast.error(`Update failed: ${String(err)}`),
  });

  // --- Derived ------------------------------------------------------------
  const realtimeOn = status.data?.realtimeEnabled ?? false;
  const scanning = scan !== null;
  const progress = scan?.progress ?? null;
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : scanning
        ? 3
        : 0;

  return (
    <div>
      <PageHeader
        title="Security"
        subtitle="Antivirus, real-time protection & quarantine"
        icon={ShieldCheck}
        actions={
          <>
            <Badge tone={realtimeOn ? "success" : "warning"}>
              <StatusDot tone={realtimeOn ? "success" : "warning"} pulse={realtimeOn} />
              {realtimeOn ? "Protected" : "Standby"}
            </Badge>
            <Tooltip content="Refresh detection signatures">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => updateDefs.mutate()}
                disabled={updateDefs.isPending}
              >
                {updateDefs.isPending ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />}
                Definitions
              </Button>
            </Tooltip>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <ProtectionHero
          status={status.data}
          loading={status.isLoading}
          pending={realtime.isPending}
          onToggle={(v) => realtime.mutate(v)}
        />

        <ScanPanel
          scanning={scanning}
          scanKind={scan?.kind ?? null}
          pct={pct}
          progress={progress}
          lastResult={lastResult}
          onScan={runScan}
          onCancel={cancelScan}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
          <Card className="h-full">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Bug className="h-4 w-4 text-danger" /> Threat log
                </CardTitle>
                <CardDescription>
                  Detections from scans &amp; real-time protection.
                </CardDescription>
              </div>
              <Badge tone={threats.data && threats.data.length > 0 ? "danger" : "success"}>
                {threats.data?.length ?? 0} total
              </Badge>
            </CardHeader>
            <ThreatLogTable threats={threats.data ?? []} loading={threats.isLoading} />
          </Card>
        </motion.div>

        <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
          <Card className="h-full">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-warning" /> Quarantine vault
                </CardTitle>
                <CardDescription>
                  Isolated, obfuscated copies — restore or delete.
                </CardDescription>
              </div>
              <Badge tone={quarantine.data && quarantine.data.length > 0 ? "warning" : "neutral"}>
                {quarantine.data?.length ?? 0} items
              </Badge>
            </CardHeader>
            <QuarantineList
              items={quarantine.data ?? []}
              loading={quarantine.isLoading}
              pendingId={pendingQuarantineId}
              onRestore={(id) => restore.mutate(id)}
              onDelete={(id) => remove.mutate(id)}
            />
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Protection hero
// ---------------------------------------------------------------------------

function ProtectionHero({
  status,
  loading,
  pending,
  onToggle,
}: {
  status: ShieldStatus | undefined;
  loading: boolean;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const on = status?.realtimeEnabled ?? false;
  return (
    <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }} className="lg:col-span-1">
      <Card className={on ? "h-full glow" : "h-full"}>
        <CardContent className="flex h-full flex-col items-center gap-5 p-6">
          {/* Animated shield emblem */}
          <div className="relative flex h-32 w-32 items-center justify-center">
            <AnimatePresence>
              {on && (
                <>
                  <motion.span
                    key="ring1"
                    className="absolute inset-0 rounded-full border border-success/40"
                    initial={{ opacity: 0.6, scale: 0.8 }}
                    animate={{ opacity: 0, scale: 1.4 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                  />
                  <motion.span
                    key="ring2"
                    className="absolute inset-0 rounded-full border border-success/30"
                    initial={{ opacity: 0.5, scale: 0.8 }}
                    animate={{ opacity: 0, scale: 1.7 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 0.6 }}
                  />
                </>
              )}
            </AnimatePresence>
            <motion.div
              animate={{ scale: on ? [1, 1.04, 1] : 1 }}
              transition={{ duration: 2.4, repeat: on ? Infinity : 0, ease: "easeInOut" }}
              className={
                "flex h-24 w-24 items-center justify-center rounded-full border " +
                (on
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-border bg-card-2 text-muted")
              }
            >
              {on ? (
                <ShieldCheck className="h-12 w-12" />
              ) : (
                <ShieldOff className="h-12 w-12" />
              )}
            </motion.div>
          </div>

          <div className="text-center">
            <h2 className="text-lg font-semibold text-foreground">
              {on ? "You're protected" : "Protection paused"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              {on
                ? "Real-time monitoring of Downloads, Temp, AppData & Startup."
                : "Enable real-time protection to monitor file activity."}
            </p>
          </div>

          {/* Real-time toggle */}
          <div className="flex w-full items-center justify-between rounded-xl border border-border/70 bg-card-2/40 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Zap className={"h-4 w-4 " + (on ? "text-success" : "text-muted")} />
              <div>
                <p className="text-sm font-medium text-foreground">Real-time protection</p>
                <p className="text-[11px] text-muted">
                  {status?.protectionLevel === "user-level"
                    ? "User-level engine"
                    : status?.protectionLevel}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pending && <Spinner className="text-muted" />}
              <Switch checked={on} disabled={pending} onCheckedChange={onToggle} />
            </div>
          </div>

          {/* Stats */}
          <div className="grid w-full grid-cols-3 gap-2">
            <HeroStat
              icon={Bug}
              label="Threats"
              value={loading ? undefined : String(status?.threatsFound ?? 0)}
              tone={status && status.threatsFound > 0 ? "danger" : "muted"}
            />
            <HeroStat
              icon={Lock}
              label="Quarantined"
              value={loading ? undefined : String(status?.quarantined ?? 0)}
              tone={status && status.quarantined > 0 ? "warning" : "muted"}
            />
            <HeroStat
              icon={Clock}
              label="Last scan"
              value={loading ? undefined : relativeTime(status?.lastScan ?? null)}
              title={absoluteTime(status?.lastScan ?? null)}
              tone="muted"
            />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function HeroStat({
  icon: Icon,
  label,
  value,
  title,
  tone,
}: {
  icon: typeof Bug;
  label: string;
  value?: string;
  title?: string;
  tone: "muted" | "danger" | "warning";
}) {
  const color =
    tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div
      className="flex flex-col items-center gap-1 rounded-xl border border-border/70 bg-card-2/40 px-2 py-3 text-center"
      title={title}
    >
      <Icon className="h-4 w-4 text-muted" />
      {value === undefined ? (
        <Skeleton className="h-4 w-10" />
      ) : (
        <span className={"text-sm font-semibold tabular-nums " + color}>{value}</span>
      )}
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scan panel
// ---------------------------------------------------------------------------

function ScanPanel({
  scanning,
  scanKind,
  pct,
  progress,
  lastResult,
  onScan,
  onCancel,
}: {
  scanning: boolean;
  scanKind: ScanKind | null;
  pct: number;
  progress: ScanProgress | null;
  lastResult: ScanResult | null;
  onScan: (kind: ScanKind) => void;
  onCancel: () => void;
}) {
  return (
    <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }} className="lg:col-span-2">
      <Card className="h-full">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" /> Scan
            </CardTitle>
            <CardDescription>
              Hash &amp; heuristic detection. Drop the EICAR test file to verify.
            </CardDescription>
          </div>
          {scanning && (
            <Badge tone="primary">
              <StatusDot tone="primary" pulse />
              {scanKind ? SCAN_LABELS[scanKind] : "Scanning"}…
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-3">
            <ScanButton
              icon={Zap}
              title="Quick"
              desc="Downloads, Temp & Startup"
              disabled={scanning}
              onClick={() => onScan("quick")}
            />
            <ScanButton
              icon={Search}
              title="Full"
              desc="Entire user profile"
              disabled={scanning}
              onClick={() => onScan("full")}
            />
            <ScanButton
              icon={FolderSearch}
              title="Custom"
              desc="Pick a folder"
              disabled={scanning}
              onClick={() => onScan("custom")}
            />
          </div>

          {/* Live progress */}
          <AnimatePresence mode="wait">
            {scanning && (
              <motion.div
                key="progress"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 overflow-hidden"
              >
                <div className="rounded-xl border border-border/70 bg-card-2/40 p-4">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted">
                      <Activity className="h-3.5 w-3.5 text-primary" />
                      {progress
                        ? `${progress.current.toLocaleString()} / ${progress.total.toLocaleString()} files`
                        : "Enumerating files…"}
                    </span>
                    <span className="font-semibold tabular-nums text-foreground">{pct}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-background">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="truncate text-[11px] text-muted" title={progress?.path}>
                      {progress?.path || "Preparing scan…"}
                    </p>
                    <Button variant="ghost" size="sm" onClick={onCancel}>
                      <X className="h-3.5 w-3.5" /> Cancel
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Last result summary */}
          <AnimatePresence>
            {!scanning && lastResult && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-border/70 bg-card-2/40 p-4"
              >
                <div
                  className={
                    "flex h-10 w-10 items-center justify-center rounded-xl border " +
                    (lastResult.threats > 0
                      ? "border-danger/30 bg-danger/10 text-danger"
                      : "border-success/30 bg-success/10 text-success")
                  }
                >
                  {lastResult.threats > 0 ? (
                    <ShieldAlert className="h-5 w-5" />
                  ) : (
                    <Sparkles className="h-5 w-5" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {lastResult.cancelled
                      ? "Scan cancelled"
                      : lastResult.threats > 0
                        ? `${lastResult.threats} threat${lastResult.threats === 1 ? "" : "s"} found`
                        : "No threats found"}
                  </p>
                  <p className="text-xs text-muted">
                    Scanned {lastResult.scanned.toLocaleString()} files in{" "}
                    {(lastResult.durationMs / 1000).toFixed(1)}s
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            <span className="font-medium text-foreground">How it works:</span> files are
            matched against a bundled SHA-256 blocklist (incl. the EICAR test
            signature) and scored with heuristics for disguised executables and
            obfuscated scripts. Known-malware is auto-quarantined; heuristic hits
            are flagged for review. Real-time monitoring is best-effort at user level.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ScanButton({
  icon: Icon,
  title,
  desc,
  disabled,
  onClick,
}: {
  icon: typeof Zap;
  title: string;
  desc: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={disabled ? undefined : { y: -2 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.15 }}
      disabled={disabled}
      onClick={onClick}
      className="app-no-drag group flex flex-col items-start gap-1 rounded-xl border border-border bg-card-2/40 p-4 text-left transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-primary transition-colors group-hover:border-primary/40">
        <Icon className="h-4 w-4" />
      </div>
      <span className="mt-1 text-sm font-semibold text-foreground">{title}</span>
      <span className="text-[11px] text-muted">{desc}</span>
    </motion.button>
  );
}
