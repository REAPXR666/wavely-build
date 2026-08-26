import { BarChart3 } from "lucide-react";
import { FeaturePlaceholder } from "@/components/FeaturePlaceholder";

export function AnalyticsPage() {
  return (
    <FeaturePlaceholder
      icon={BarChart3}
      title="Analytics"
      subtitle="Threat history & performance trends"
      owner="Control Hub"
      capabilities={[
        "Threat detection history",
        "System performance trends",
        "VPN usage & data transfer",
        "Scan activity timeline",
        "Exportable reports",
        "Persisted historical data",
      ]}
    />
  );
}
