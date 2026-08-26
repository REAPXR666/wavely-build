import { Settings } from "lucide-react";
import { FeaturePlaceholder } from "@/components/FeaturePlaceholder";

export function SettingsPage() {
  return (
    <FeaturePlaceholder
      icon={Settings}
      title="Settings"
      subtitle="Preferences & app configuration"
      owner="Control Hub"
      capabilities={[
        "Theme & appearance",
        "Startup & tray behavior",
        "Protection preferences",
        "VPN defaults",
        "Notifications",
        "About & updates",
      ]}
    />
  );
}
