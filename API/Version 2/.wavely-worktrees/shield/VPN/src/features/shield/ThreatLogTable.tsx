import { motion } from "framer-motion";
import { Bug, FileWarning, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tooltip } from "@/components/ui/Tooltip";
import type { ThreatEntry } from "@/types/shield";
import { absoluteTime, actionTone, relativeTime, severityTone, shortenPath } from "./lib";

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical" || severity === "high") {
    return <Bug className="h-3.5 w-3.5" />;
  }
  return <FileWarning className="h-3.5 w-3.5" />;
}

export function ThreatLogTable({
  threats,
  loading,
}: {
  threats: ThreatEntry[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-5 pt-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (threats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-success/30 bg-success/10 text-success">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">No threats detected</p>
          <p className="mt-1 text-xs text-muted">
            Your threat log is clean. Run a scan or enable real-time protection
            to keep it that way.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-border px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted">
        <span>Threat / Path</span>
        <span className="text-center">Severity</span>
        <span className="text-center">Action</span>
        <span className="text-right">Detected</span>
      </div>
      <div className="max-h-[360px] divide-y divide-border/60 overflow-y-auto">
        {threats.map((t, i) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: Math.min(i * 0.015, 0.2) }}
            className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-5 py-3 transition-colors hover:bg-card-2/40"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground" title={t.name}>
                {t.name}
              </p>
              <Tooltip content={t.path} side="bottom">
                <p className="truncate text-xs text-muted">{shortenPath(t.path)}</p>
              </Tooltip>
            </div>
            <Badge tone={severityTone(t.severity)} className="justify-center capitalize">
              <SeverityIcon severity={t.severity} />
              {t.severity}
            </Badge>
            <Badge tone={actionTone(t.action)} className="justify-center capitalize">
              {t.action}
            </Badge>
            <Tooltip content={absoluteTime(t.detectedAt)} side="left">
              <span className="text-right text-xs tabular-nums text-muted">
                {relativeTime(t.detectedAt)}
              </span>
            </Tooltip>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
