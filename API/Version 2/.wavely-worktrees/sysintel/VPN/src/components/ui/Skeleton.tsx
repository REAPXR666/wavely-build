import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-md", className)}
      style={{
        backgroundImage:
          "linear-gradient(90deg, var(--color-card-2), color-mix(in srgb, var(--color-card-2) 55%, #ffffff 10%), var(--color-card-2))",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.6s linear infinite",
      }}
    />
  );
}
