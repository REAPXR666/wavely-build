import { motion } from "framer-motion";
import { useEffect } from "react";

export function LoadingSplash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 1900);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background"
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-30" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-[120px]" />

      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative flex flex-col items-center gap-6"
      >
        <div className="relative">
          <motion.div
            className="absolute inset-0 rounded-3xl bg-primary/30 blur-2xl"
            animate={{ opacity: [0.35, 0.8, 0.35], scale: [1, 1.1, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
          <img
            src="/wavely-loading.png"
            alt="Wavely Protection"
            className="relative h-24 w-24 object-contain drop-shadow-[0_0_24px_rgba(34,211,238,0.45)]"
          />
        </div>

        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Wavely <span className="text-gradient">Protection</span>
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            Initializing secure environment…
          </p>
        </div>

        <div className="h-1 w-56 overflow-hidden rounded-full bg-card-2">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 1.7, ease: "easeInOut" }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
