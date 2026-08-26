import { motion } from "framer-motion";
import { Lock, RotateCcw, Trash2, Vault } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import type { QuarantineItem } from "@/types/shield";
import { absoluteTime, relativeTime, severityTone, shortenPath } from "./lib";

export function QuarantineList({
  items,
  loading,
  pendingId,
  onRestore,
  onDelete,
}: {
  items: QuarantineItem[];
  loading: boolean;
  pendingId: string | null;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-5 pt-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card-2 text-muted">
          <Vault className="h-7 w-7" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Vault is empty</p>
          <p className="mt-1 text-xs text-muted">
            Quarantined files are encrypted and stored safely here. Known-malware
            detections are moved automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-h-[360px] space-y-2 overflow-y-auto p-5 pt-0">
      {items.map((item, i) => {
        const busy = pendingId === item.id;
        return (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: Math.min(i * 0.02, 0.2) }}
            className="flex items-center gap-3 rounded-xl border border-border/70 bg-card-2/40 p-3"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-warning/30 bg-warning/10 text-warning">
              <Lock className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground" title={item.name}>
                  {item.name}
                </p>
                {item.severity && (
                  <Badge tone={severityTone(item.severity)} className="capitalize">
                    {item.severity}
                  </Badge>
                )}
              </div>
              <Tooltip content={item.originalPath} side="bottom">
                <p className="truncate text-xs text-muted">
                  {item.threat ? `${item.threat} · ` : ""}
                  {shortenPath(item.originalPath, 40)}
                </p>
              </Tooltip>
            </div>
            <Tooltip content={absoluteTime(item.quarantinedAt)} side="top">
              <span className="hidden shrink-0 text-xs tabular-nums text-muted sm:block">
                {relativeTime(item.quarantinedAt)}
              </span>
            </Tooltip>
            <div className="flex shrink-0 items-center gap-1.5">
              <Tooltip content="Restore to original location">
                <Button
                  variant="secondary"
                  size="icon"
                  disabled={busy}
                  onClick={() => onRestore(item.id)}
                  aria-label="Restore"
                >
                  {busy ? <Spinner /> : <RotateCcw className="h-4 w-4" />}
                </Button>
              </Tooltip>
              <Tooltip content="Delete permanently">
                <Button
                  variant="danger"
                  size="icon"
                  disabled={busy}
                  onClick={() => onDelete(item.id)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Tooltip>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
