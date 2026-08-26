import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Polished empty / no-data state for a chart area. Keeps the same footprint as
 * a populated chart so layouts don't jump.
 */
export function ChartEmpty({
  icon: Icon,
  title,
  hint,
  height = 220,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  height?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed border-border/70 bg-card-2/30 text-center",
        className,
      )}
      style={{ height }}
    >
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-30" />
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
        className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-muted"
      >
        <Icon className="h-5 w-5" />
      </motion.div>
      <p className="relative text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="relative max-w-xs text-xs text-muted">{hint}</p>}
    </div>
  );
}
