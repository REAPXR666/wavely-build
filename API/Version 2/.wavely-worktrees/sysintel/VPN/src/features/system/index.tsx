import * as React from "react";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import * as Tabs from "@radix-ui/react-tabs";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  HardDrive,
  Layers,
  Lock,
  MemoryStick,
  Monitor,
  Package,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  Wifi,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusDot } from "@/components/ui/StatusDot";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip, TooltipProvider } from "@/components/ui/Tooltip";
import { MetricRing } from "@/components/telemetry/MetricRing";
import { Sparkline } from "@/components/telemetry/Sparkline";
import { useTelemetry } from "@/hooks/useTelemetry";
import { systemApi } from "@/lib/ipc/system";
import { cn, formatBytes, formatRate, formatUptime } from "@/lib/utils";
import type {
  DiskInfo,
  NetConnection,
  ProcessInfo,
  StartupItem,
} from "@/types/system";

// ── Helpers ───────────────────────────────────────────────────────────────────

function riskTone(risk: string): "success" | "warning" | "danger" | "neutral" {
  if (risk === "low") return "success";
  if (risk === "medium") return "warning";
  if (risk === "high") return "danger";
  return "neutral";
}

function stateTone(
  state: string,
): "success" | "primary" | "warning" | "neutral" | "danger" {
  const s = state.toUpperCase();
  if (s === "ESTABLISHED") return "success";
  if (s === "LISTENING") return "primary";
  if (s === "TIME_WAIT" || s === "CLOSE_WAIT") return "warning";
  if (s === "SYN_SENT" || s === "SYN_RECV") return "warning";
  return "neutral";
}

function cpuTone(cpu: number): "danger" | "warning" | "primary" | "success" {
  if (cpu > 50) return "danger";
  if (cpu > 20) return "warning";
  if (cpu > 5) return "primary";
  return "success";
}

// ── Skeleton rows ─────────────────────────────────────────────────────────────

function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border/40 px-4 py-3"
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="ml-auto h-4 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-6 w-14" />
        </div>
      ))}
    </>
  );
}

// ── Tab trigger ───────────────────────────────────────────────────────────────

function TabTrigger({
  value,
  icon: Icon,
  label,
  count,
}: {
  value: string;
  icon: LucideIcon;
  label: string;
  count?: number;
}) {
  return (
    <Tabs.Trigger
      value={value}
      className={cn(
        "app-no-drag flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium text-muted",
        "transition-all duration-200 hover:text-foreground",
        "data-[state=active]:bg-card-2 data-[state=active]:text-primary data-[state=active]:shadow-sm",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {count !== undefined && (
        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
          {count}
        </span>
      )}
    </Tabs.Trigger>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {subtitle && <p className="text-[11px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

// ── Live telemetry strip ──────────────────────────────────────────────────────

function LiveMetricsStrip() {
  const { latest, history } = useTelemetry();

  const cpu = latest?.cpuUsage ?? 0;
  const memPct = latest && latest.memTotal ? (latest.memUsed / latest.memTotal) * 100 : 0;
  const rxRate = latest?.netRxRate ?? 0;
  const txRate = latest?.netTxRate ?? 0;
  const rxSeries = history.map((t) => t.netRxRate);
  const txSeries = history.map((t) => t.netTxRate);
  const cpuSeries = history.map((t) => t.cpuUsage);

  return (
    <div className="mb-5 grid gap-4 lg:grid-cols-4">
      {/* CPU */}
      <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
        <Card className="h-full">
          <CardContent className="flex flex-col items-center gap-3 p-5">
            <div className="flex w-full items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Cpu className="h-3.5 w-3.5 text-primary" /> CPU
              </span>
              <Badge tone={cpu > 80 ? "danger" : cpu > 50 ? "warning" : "primary"}>
                {Math.round(cpu)}%
              </Badge>
            </div>
            <MetricRing value={cpu} size={100} stroke={9} label="Load" />
            <div className="h-8 w-full">
              <Sparkline data={cpuSeries} domain={[0, 100]} />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Memory */}
      <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
        <Card className="h-full">
          <CardContent className="flex flex-col items-center gap-3 p-5">
            <div className="flex w-full items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <MemoryStick className="h-3.5 w-3.5 text-accent" /> Memory
              </span>
              <Badge
                tone={memPct > 85 ? "danger" : memPct > 70 ? "warning" : "primary"}
              >
                {Math.round(memPct)}%
              </Badge>
            </div>
            <MetricRing
              value={memPct}
              size={100}
              stroke={9}
              from="var(--color-accent)"
              to="var(--color-primary)"
              label="Used"
            />
            <p className="text-[11px] text-muted">
              {latest
                ? `${formatBytes(latest.memUsed)} / ${formatBytes(latest.memTotal)}`
                : "—"}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Network download */}
      <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
        <Card className="h-full">
          <CardContent className="flex flex-col gap-3 p-5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <ArrowDown className="h-3.5 w-3.5 text-success" /> Download
            </span>
            <p className="text-2xl font-semibold tabular-nums text-foreground">
              {formatRate(rxRate)}
            </p>
            <div className="flex-1">
              <Sparkline data={rxSeries} color="var(--color-success)" height={44} />
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Network upload */}
      <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
        <Card className="h-full">
          <CardContent className="flex flex-col gap-3 p-5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <ArrowUp className="h-3.5 w-3.5 text-primary" /> Upload
            </span>
            <p className="text-2xl font-semibold tabular-nums text-foreground">
              {formatRate(txRate)}
            </p>
            <div className="flex-1">
              <Sparkline data={txSeries} color="var(--color-primary)" height={44} />
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// ── Processes panel ───────────────────────────────────────────────────────────

type SortCol = "cpu" | "mem" | "name" | "pid";
type SortDir = "asc" | "desc";

function ProcessesPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ col: SortCol; dir: SortDir }>({
    col: "cpu",
    dir: "desc",
  });
  const [confirmKill, setConfirmKill] = useState<number | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["sys", "processes"],
    queryFn: systemApi.getProcesses,
    refetchInterval: 5000,
  });

  const killMutation = useMutation({
    mutationFn: (pid: number) => systemApi.killProcess(pid),
    onSuccess: (ok, pid) => {
      if (ok) {
        toast.success(`Process ${pid} terminated`);
        void qc.invalidateQueries({ queryKey: ["sys", "processes"] });
      } else {
        toast.error(`Failed to terminate process ${pid}`);
      }
      setConfirmKill(null);
    },
    onError: (err: unknown, pid) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Kill failed (PID ${pid}): ${msg}`);
      setConfirmKill(null);
    },
  });

  const sorted = useMemo(() => {
    if (!data) return [];
    const filtered = data.filter(
      (p) =>
        search === "" ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        String(p.pid).includes(search),
    );
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sort.col === "cpu") cmp = a.cpu - b.cpu;
      else if (sort.col === "mem") cmp = a.mem - b.mem;
      else if (sort.col === "name") cmp = a.name.localeCompare(b.name);
      else if (sort.col === "pid") cmp = a.pid - b.pid;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, search, sort]);

  const toggleSort = (col: SortCol) => {
    setSort((s) =>
      s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" },
    );
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sort.col !== col) return null;
    return sort.dir === "asc" ? (
      <ChevronUp className="h-3 w-3" />
    ) : (
      <ChevronDown className="h-3 w-3" />
    );
  };

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={Terminal}
        title="Process Explorer"
        subtitle="Live CPU + memory per process · refreshes every 5 s"
        action={
          <div className="flex items-center gap-2">
            {isFetching && <Spinner className="h-3 w-3 text-muted" />}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refetch()}
              className="app-no-drag h-7 gap-1 px-2 text-[11px]"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
          </div>
        }
      />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="Filter by name or PID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="app-no-drag w-full rounded-xl border border-border bg-card-2/60 py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted focus:border-primary/50 focus:outline-none"
        />
      </div>

      <Card className="overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_80px_100px_90px] items-center border-b border-border/60 bg-card-2/40 px-4 py-2 text-[11px] uppercase tracking-wider text-muted">
          <button
            className="app-no-drag flex items-center gap-1 text-left hover:text-foreground"
            onClick={() => toggleSort("name")}
          >
            Process <SortIcon col="name" />
          </button>
          <button
            className="app-no-drag flex items-center gap-1 justify-end hover:text-foreground"
            onClick={() => toggleSort("cpu")}
          >
            CPU <SortIcon col="cpu" />
          </button>
          <button
            className="app-no-drag flex items-center gap-1 justify-end hover:text-foreground"
            onClick={() => toggleSort("mem")}
          >
            Memory <SortIcon col="mem" />
          </button>
          <span className="text-right">Action</span>
        </div>

        {/* Body */}
        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <SkeletonRows count={8} />
          ) : isError ? (
            <div className="flex items-center gap-2 p-6 text-xs text-danger">
              <AlertTriangle className="h-4 w-4" /> Failed to load processes
            </div>
          ) : sorted.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted">No processes found</div>
          ) : (
            sorted.map((p) => (
              <ProcessRow
                key={p.pid}
                proc={p}
                isConfirming={confirmKill === p.pid}
                isKilling={killMutation.isPending && killMutation.variables === p.pid}
                onKillClick={() => {
                  if (confirmKill === p.pid) {
                    killMutation.mutate(p.pid);
                  } else {
                    setConfirmKill(p.pid);
                    setTimeout(
                      () => setConfirmKill((c) => (c === p.pid ? null : c)),
                      3000,
                    );
                  }
                }}
                onCancelKill={() => setConfirmKill(null)}
              />
            ))
          )}
        </div>

        {sorted.length > 0 && (
          <div className="border-t border-border/40 px-4 py-2 text-[11px] text-muted">
            {sorted.length} process{sorted.length !== 1 ? "es" : ""}
            {search && ` matching "${search}"`}
          </div>
        )}
      </Card>
    </div>
  );
}

function ProcessRow({
  proc,
  isConfirming,
  isKilling,
  onKillClick,
  onCancelKill,
}: {
  proc: ProcessInfo;
  isConfirming: boolean;
  isKilling: boolean;
  onKillClick: () => void;
  onCancelKill: () => void;
}) {
  return (
    <div
      className={cn(
        "group grid grid-cols-[1fr_80px_100px_90px] items-center border-b border-border/30 px-4 py-2.5 text-xs transition-colors",
        isConfirming && "bg-danger/5",
        !isConfirming && "hover:bg-card-2/30",
      )}
    >
      {/* Name + PID */}
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-foreground">{proc.name}</span>
        <span className="text-[10px] text-muted">
          PID {proc.pid}
          {proc.parent != null && ` · parent ${proc.parent}`}
        </span>
      </div>

      {/* CPU */}
      <div className="text-right">
        <Badge
          tone={cpuTone(proc.cpu)}
          className="min-w-[44px] justify-center text-[11px]"
        >
          {proc.cpu.toFixed(1)}%
        </Badge>
      </div>

      {/* Memory */}
      <div className="text-right text-muted">{formatBytes(proc.mem)}</div>

      {/* Kill action */}
      <div className="flex items-center justify-end gap-1">
        {isKilling ? (
          <Spinner className="h-3 w-3 text-danger" />
        ) : isConfirming ? (
          <>
            <button
              onClick={onKillClick}
              className="app-no-drag rounded px-1.5 py-0.5 text-[10px] font-medium text-danger hover:bg-danger/20"
            >
              Confirm
            </button>
            <button
              onClick={onCancelKill}
              className="app-no-drag rounded px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground"
            >
              ✕
            </button>
          </>
        ) : (
          <button
            onClick={onKillClick}
            className="app-no-drag rounded p-1 text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
            title="Kill process"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Disks panel ───────────────────────────────────────────────────────────────

function DisksPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["sys", "disks"],
    queryFn: systemApi.getDisks,
    staleTime: 30_000,
  });

  return (
    <div className="space-y-3">
      <SectionHeader icon={HardDrive} title="Storage" subtitle="Physical disks & partitions" />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="space-y-3 p-5">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-4 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 text-xs text-danger">
          <AlertTriangle className="h-4 w-4" /> Failed to load disks
        </div>
      ) : !data?.length ? (
        <p className="text-xs text-muted">No disks detected</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((disk, i) => (
            <DiskCard key={i} disk={disk} />
          ))}
        </div>
      )}
    </div>
  );
}

function DiskCard({ disk }: { disk: DiskInfo }) {
  const used = disk.total - disk.available;
  const pct = disk.total > 0 ? (used / disk.total) * 100 : 0;
  const tone =
    pct > 90 ? "text-danger" : pct > 75 ? "text-warning" : "text-success";

  return (
    <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {disk.mount || disk.name}
              </p>
              <p className="text-[11px] text-muted">{disk.name}</p>
            </div>
            <Badge
              tone={disk.kind === "SSD" ? "primary" : disk.kind === "HDD" ? "neutral" : "neutral"}
            >
              {disk.kind === "SSD" ? (
                <Database className="h-3 w-3" />
              ) : (
                <HardDrive className="h-3 w-3" />
              )}
              {disk.kind}
            </Badge>
          </div>

          {/* Usage bar */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-muted">Used</span>
              <span className={cn("font-medium", tone)}>{Math.round(pct)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-card-2">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  pct > 90
                    ? "bg-danger"
                    : pct > 75
                      ? "bg-warning"
                      : "bg-gradient-to-r from-primary to-accent",
                )}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>{formatBytes(used)} used</span>
            <span>{formatBytes(disk.total)} total</span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── Startup panel ─────────────────────────────────────────────────────────────

function StartupPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["sys", "startup"],
    queryFn: systemApi.getStartupItems,
    staleTime: 60_000,
  });

  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () =>
      (data ?? []).filter(
        (s) =>
          search === "" ||
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.location.toLowerCase().includes(search.toLowerCase()),
      ),
    [data, search],
  );

  const highCount = (data ?? []).filter((s) => s.risk === "high").length;

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={Layers}
        title="Startup Items"
        subtitle="Registry Run keys, startup folders — signed status is path-based heuristic"
        action={
          highCount > 0 ? (
            <Badge tone="danger">
              <AlertTriangle className="h-3 w-3" />
              {highCount} high-risk
            </Badge>
          ) : null
        }
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="Filter startup items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="app-no-drag w-full rounded-xl border border-border bg-card-2/60 py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted focus:border-primary/50 focus:outline-none"
        />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <SkeletonRows count={5} />
        ) : isError ? (
          <div className="flex items-center gap-2 p-6 text-xs text-danger">
            <AlertTriangle className="h-4 w-4" /> Failed to load startup items
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted">
            {data?.length === 0 ? "No startup items found" : "No items match filter"}
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto divide-y divide-border/30">
            {filtered.map((item, i) => (
              <StartupRow key={i} item={item} />
            ))}
          </div>
        )}
        {filtered.length > 0 && (
          <div className="border-t border-border/40 px-4 py-2 text-[11px] text-muted">
            {filtered.length} item{filtered.length !== 1 ? "s" : ""}
          </div>
        )}
      </Card>
    </div>
  );
}

function StartupRow({ item }: { item: StartupItem }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-card-2/30 transition-colors">
      <div className="mt-0.5 shrink-0">
        {item.risk === "high" ? (
          <ShieldAlert className="h-4 w-4 text-danger" />
        ) : item.risk === "medium" ? (
          <Shield className="h-4 w-4 text-warning" />
        ) : (
          <ShieldCheck className="h-4 w-4 text-success" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-foreground">{item.name}</span>
          <Badge tone={riskTone(item.risk)} className="text-[10px]">
            {item.risk}
          </Badge>
          <Tooltip
            content={
              item.signed
                ? "Path is in a known system/program location (heuristic)"
                : "Path is not in a known system location (heuristic)"
            }
          >
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px]",
                item.signed
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-muted/30 bg-card-2 text-muted",
              )}
            >
              {item.signed ? (
                <CheckCircle2 className="h-2.5 w-2.5" />
              ) : (
                <XCircle className="h-2.5 w-2.5" />
              )}
              {item.signed ? "Signed" : "Unverified"}
            </span>
          </Tooltip>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted" title={item.location}>
          {item.location}
        </p>
        <p className="mt-0.5 text-[10px] text-muted/70">{item.kind}</p>
      </div>
    </div>
  );
}

// ── Network panel ─────────────────────────────────────────────────────────────

function NetworkPanel() {
  const [search, setSearch] = useState("");
  const [protoFilter, setProtoFilter] = useState<"ALL" | "TCP" | "UDP">("ALL");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["sys", "network"],
    queryFn: systemApi.getNetworkConnections,
    refetchInterval: 10_000,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((c) => {
      if (protoFilter !== "ALL" && !c.proto.startsWith(protoFilter)) return false;
      if (search === "") return true;
      return (
        c.local.includes(search) ||
        c.remote.includes(search) ||
        (c.pid != null && String(c.pid).includes(search)) ||
        c.state.toLowerCase().includes(search.toLowerCase())
      );
    });
  }, [data, search, protoFilter]);

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={Wifi}
        title="Network Connections"
        subtitle="Active TCP/UDP sockets from netstat · refreshes every 10 s"
        action={
          <div className="flex items-center gap-2">
            {isFetching && <Spinner className="h-3 w-3 text-muted" />}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refetch()}
              className="app-no-drag h-7 gap-1 px-2 text-[11px]"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
          </div>
        }
      />

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Filter by address, state, or PID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="app-no-drag w-full rounded-xl border border-border bg-card-2/60 py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted focus:border-primary/50 focus:outline-none"
          />
        </div>
        <div className="flex rounded-xl border border-border bg-card-2/60 p-0.5">
          {(["ALL", "TCP", "UDP"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProtoFilter(p)}
              className={cn(
                "app-no-drag rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors",
                protoFilter === p
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted hover:text-foreground",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[60px_1fr_1fr_90px_60px] items-center border-b border-border/60 bg-card-2/40 px-4 py-2 text-[11px] uppercase tracking-wider text-muted">
          <span>Proto</span>
          <span>Local</span>
          <span>Remote</span>
          <span>State</span>
          <span>PID</span>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <SkeletonRows count={6} />
          ) : isError ? (
            <div className="flex items-center gap-2 p-6 text-xs text-danger">
              <AlertTriangle className="h-4 w-4" /> Failed to load connections
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted">No connections found</div>
          ) : (
            filtered.slice(0, 200).map((c, i) => (
              <NetRow key={i} conn={c} />
            ))
          )}
        </div>
        {filtered.length > 0 && (
          <div className="border-t border-border/40 px-4 py-2 text-[11px] text-muted">
            {filtered.length} connection{filtered.length !== 1 ? "s" : ""}
            {filtered.length > 200 && " (showing first 200)"}
          </div>
        )}
      </Card>
    </div>
  );
}

function NetRow({ conn }: { conn: NetConnection }) {
  return (
    <div className="grid grid-cols-[60px_1fr_1fr_90px_60px] items-center border-b border-border/30 px-4 py-2.5 text-xs hover:bg-card-2/30 transition-colors">
      <Badge
        tone={conn.proto.startsWith("TCP") ? "primary" : "neutral"}
        className="justify-center text-[10px]"
      >
        {conn.proto}
      </Badge>
      <span className="truncate font-mono text-[11px] text-foreground" title={conn.local}>
        {conn.local}
      </span>
      <span
        className="truncate font-mono text-[11px] text-muted"
        title={conn.remote}
      >
        {conn.remote === "0.0.0.0:0" || conn.remote === "*:*" ? (
          <span className="text-muted/50">—</span>
        ) : (
          conn.remote
        )}
      </span>
      {conn.state ? (
        <Badge
          tone={stateTone(conn.state)}
          className="justify-center text-[10px]"
        >
          {conn.state}
        </Badge>
      ) : (
        <span />
      )}
      <span className="text-muted">{conn.pid ?? "—"}</span>
    </div>
  );
}

// ── Software panel ────────────────────────────────────────────────────────────

function SoftwarePanel() {
  const [search, setSearch] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sys", "software"],
    queryFn: systemApi.getInstalledSoftware,
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(
    () =>
      (data ?? []).filter(
        (s) =>
          search === "" ||
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.publisher.toLowerCase().includes(search.toLowerCase()),
      ),
    [data, search],
  );

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={Package}
        title="Installed Software"
        subtitle="From Windows Uninstall registry keys"
        action={
          data && (
            <Badge tone="neutral">{data.length} apps</Badge>
          )
        }
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input
          type="text"
          placeholder="Search software…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="app-no-drag w-full rounded-xl border border-border bg-card-2/60 py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted focus:border-primary/50 focus:outline-none"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1fr_120px_140px] items-center border-b border-border/60 bg-card-2/40 px-4 py-2 text-[11px] uppercase tracking-wider text-muted">
          <span>Name</span>
          <span>Version</span>
          <span>Publisher</span>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <SkeletonRows count={8} />
          ) : isError ? (
            <div className="flex items-center gap-2 p-6 text-xs text-danger">
              <AlertTriangle className="h-4 w-4" /> Failed to load software
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted">No software found</div>
          ) : (
            filtered.slice(0, 300).map((s, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_120px_140px] items-center border-b border-border/30 px-4 py-2.5 text-xs hover:bg-card-2/30 transition-colors"
              >
                <span className="truncate font-medium text-foreground" title={s.name}>
                  {s.name}
                </span>
                <span className="truncate text-muted" title={s.version}>
                  {s.version || "—"}
                </span>
                <span className="truncate text-muted" title={s.publisher}>
                  {s.publisher || "—"}
                </span>
              </div>
            ))
          )}
        </div>
        {filtered.length > 0 && (
          <div className="border-t border-border/40 px-4 py-2 text-[11px] text-muted">
            {filtered.length} app{filtered.length !== 1 ? "s" : ""}
            {filtered.length > 300 && " (showing first 300)"}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Drivers panel ─────────────────────────────────────────────────────────────

function DriversPanel() {
  const [search, setSearch] = useState("");
  const [signedFilter, setSignedFilter] = useState<"ALL" | "SIGNED" | "UNSIGNED">(
    "ALL",
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sys", "drivers"],
    queryFn: systemApi.getDrivers,
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((d) => {
      if (signedFilter === "SIGNED" && !d.signed) return false;
      if (signedFilter === "UNSIGNED" && d.signed) return false;
      if (search === "") return true;
      return (
        d.name.toLowerCase().includes(search.toLowerCase()) ||
        d.version.toLowerCase().includes(search.toLowerCase())
      );
    });
  }, [data, search, signedFilter]);

  const unsignedCount = (data ?? []).filter((d) => !d.signed).length;

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={Layers}
        title="Device Drivers"
        subtitle="Win32_PnPSignedDriver via WMI · may take a moment to load"
        action={
          unsignedCount > 0 ? (
            <Badge tone="warning">
              <AlertTriangle className="h-3 w-3" />
              {unsignedCount} unsigned
            </Badge>
          ) : data ? (
            <Badge tone="success">
              <ShieldCheck className="h-3 w-3" /> All signed
            </Badge>
          ) : null
        }
      />

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search drivers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="app-no-drag w-full rounded-xl border border-border bg-card-2/60 py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted focus:border-primary/50 focus:outline-none"
          />
        </div>
        <div className="flex rounded-xl border border-border bg-card-2/60 p-0.5">
          {(["ALL", "SIGNED", "UNSIGNED"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setSignedFilter(f)}
              className={cn(
                "app-no-drag rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors",
                signedFilter === f
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1fr_140px_80px] items-center border-b border-border/60 bg-card-2/40 px-4 py-2 text-[11px] uppercase tracking-wider text-muted">
          <span>Name</span>
          <span>Version</span>
          <span>Signed</span>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted">
              <Spinner className="h-4 w-4" />
              Querying WMI…
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 p-6 text-xs text-danger">
              <AlertTriangle className="h-4 w-4" /> Failed to load drivers
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted">No drivers found</div>
          ) : (
            filtered.slice(0, 300).map((d, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_140px_80px] items-center border-b border-border/30 px-4 py-2.5 text-xs hover:bg-card-2/30 transition-colors"
              >
                <span className="truncate font-medium text-foreground" title={d.name}>
                  {d.name}
                </span>
                <span className="truncate text-muted font-mono text-[11px]">
                  {d.version || "—"}
                </span>
                {d.signed ? (
                  <Badge tone="success" className="justify-center text-[10px] w-fit">
                    <CheckCircle2 className="h-3 w-3" /> Yes
                  </Badge>
                ) : (
                  <Badge tone="warning" className="justify-center text-[10px] w-fit">
                    <XCircle className="h-3 w-3" /> No
                  </Badge>
                )}
              </div>
            ))
          )}
        </div>
        {filtered.length > 0 && (
          <div className="border-t border-border/40 px-4 py-2 text-[11px] text-muted">
            {filtered.length} driver{filtered.length !== 1 ? "s" : ""}
            {filtered.length > 300 && " (showing first 300)"}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Advanced panel ────────────────────────────────────────────────────────────

function AdvancedPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["sys", "advanced"],
    queryFn: systemApi.advancedInfo,
    staleTime: 60_000,
  });

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={Lock}
        title="Advanced Security Info"
        subtitle="Secure Boot, TPM, and virtualization — read from registry & WMI"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <AdvancedCard
          icon={ShieldCheck}
          label="Secure Boot"
          value={isLoading ? null : data?.secureBoot}
          loading={isLoading}
          error={isError}
          trueLabel="Enabled"
          falseLabel="Disabled / Unavailable"
          description="UEFI Secure Boot state from registry"
        />
        <AdvancedCard
          icon={Shield}
          label="TPM"
          value={isLoading ? null : data?.tpmPresent}
          loading={isLoading}
          error={isError}
          trueLabel="Present"
          falseLabel="Not Detected"
          description="Trusted Platform Module presence via Get-Tpm / WMI"
        />
        <AdvancedCard
          icon={Monitor}
          label="Hypervisor"
          value={isLoading ? null : data?.virtualization}
          loading={isLoading}
          error={isError}
          trueLabel="Detected"
          falseLabel="Not Detected"
          description="HypervisorPresent via Win32_ComputerSystem"
        />
      </div>
    </div>
  );
}

function AdvancedCard({
  icon: Icon,
  label,
  value,
  loading,
  error,
  trueLabel,
  falseLabel,
  description,
}: {
  icon: LucideIcon;
  label: string;
  value: boolean | null | undefined;
  loading: boolean;
  error: boolean;
  trueLabel: string;
  falseLabel: string;
  description: string;
}) {
  const tone = value === true ? "success" : value === false ? "neutral" : "neutral";

  return (
    <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.2 }}>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl border",
              value === true
                ? "border-success/30 bg-success/10 text-success"
                : value === false
                  ? "border-border bg-card-2 text-muted"
                  : "border-border bg-card-2 text-muted",
            )}
          >
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">{label}</p>
            <p className="mt-0.5 text-[11px] text-muted">{description}</p>
          </div>
          {loading ? (
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Spinner className="h-3 w-3" /> Querying…
            </div>
          ) : error ? (
            <Badge tone="neutral">Unknown</Badge>
          ) : (
            <Badge tone={tone as "success" | "neutral"}>
              {value === true ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {value === true ? trueLabel : falseLabel}
            </Badge>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ── System identity card ──────────────────────────────────────────────────────

function SystemIdentityCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["sys", "overview"],
    queryFn: systemApi.getOverview,
    staleTime: 60_000,
  });

  const fields: Array<{ icon: LucideIcon; label: string; value?: string }> = [
    { icon: Server, label: "Host", value: data?.hostName },
    { icon: Monitor, label: "OS", value: data?.os },
    { icon: Cpu, label: "Processor", value: data?.cpuBrand },
    {
      icon: Layers,
      label: "Cores",
      value: data ? `${data.cpuCores} logical` : undefined,
    },
    {
      icon: MemoryStick,
      label: "RAM",
      value: data ? formatBytes(data.memTotal) : undefined,
    },
    {
      icon: Activity,
      label: "Uptime",
      value: data ? formatUptime(data.uptime) : undefined,
    },
  ];

  return (
    <Card className="mb-5">
      <CardContent className="grid grid-cols-2 gap-3 p-5 md:grid-cols-3 xl:grid-cols-6">
        {fields.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card-2 text-primary">
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
              {isLoading ? (
                <Skeleton className="mt-1 h-3.5 w-20" />
              ) : (
                <p
                  className="truncate text-xs font-medium text-foreground"
                  title={value}
                >
                  {value || "—"}
                </p>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SystemPage() {
  const { latest } = useTelemetry();
  const live = latest !== null;

  return (
    <TooltipProvider>
      <div>
        <PageHeader
          title="System Intelligence"
          subtitle="Live diagnostics, process explorer & security audit"
          icon={Cpu}
          actions={
            <>
              <Badge tone={live ? "primary" : "neutral"}>
                <StatusDot tone={live ? "primary" : "muted"} pulse={live} />
                {live ? "Live" : "Connecting…"}
              </Badge>
            </>
          }
        />

        {/* System identity */}
        <SystemIdentityCard />

        {/* Live metrics */}
        <LiveMetricsStrip />

        {/* Tabbed sections */}
        <Tabs.Root defaultValue="processes">
          <div className="mb-4 overflow-x-auto">
            <Tabs.List className="flex gap-1 rounded-2xl border border-border bg-card/60 p-1 backdrop-blur">
              <TabTrigger value="processes" icon={Terminal} label="Processes" />
              <TabTrigger value="disks" icon={HardDrive} label="Disks" />
              <TabTrigger value="startup" icon={Layers} label="Startup" />
              <TabTrigger value="network" icon={Wifi} label="Network" />
              <TabTrigger value="software" icon={Package} label="Software" />
              <TabTrigger value="drivers" icon={Database} label="Drivers" />
              <TabTrigger value="advanced" icon={Lock} label="Advanced" />
            </Tabs.List>
          </div>

          <Tabs.Content value="processes" className="focus:outline-none">
            <ProcessesPanel />
          </Tabs.Content>
          <Tabs.Content value="disks" className="focus:outline-none">
            <DisksPanel />
          </Tabs.Content>
          <Tabs.Content value="startup" className="focus:outline-none">
            <StartupPanel />
          </Tabs.Content>
          <Tabs.Content value="network" className="focus:outline-none">
            <NetworkPanel />
          </Tabs.Content>
          <Tabs.Content value="software" className="focus:outline-none">
            <SoftwarePanel />
          </Tabs.Content>
          <Tabs.Content value="drivers" className="focus:outline-none">
            <DriversPanel />
          </Tabs.Content>
          <Tabs.Content value="advanced" className="focus:outline-none">
            <AdvancedPanel />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </TooltipProvider>
  );
}
