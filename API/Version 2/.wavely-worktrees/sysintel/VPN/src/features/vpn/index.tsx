import { Globe2 } from "lucide-react";
import { FeaturePlaceholder } from "@/components/FeaturePlaceholder";

export function VpnPage() {
  return (
    <FeaturePlaceholder
      icon={Globe2}
      title="VPN"
      subtitle="Encrypted WireGuard tunnel & servers"
      owner="VPN Core"
      capabilities={[
        "WireGuard config import & generation",
        "Bring-your-own-server real tunnel",
        "Curated server list with live ping",
        "Kill switch & DNS-leak protection",
        "Live throughput & handshake stats",
        "Demo connection mode",
      ]}
    />
  );
}
