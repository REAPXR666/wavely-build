import { AnimatePresence } from "framer-motion";
import { useState } from "react";
import { AppProviders } from "@/app/providers";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingSplash } from "@/components/LoadingSplash";

function App() {
  const [ready, setReady] = useState(false);

  return (
    <AppProviders>
      <AppShell />
      <AnimatePresence>
        {!ready && <LoadingSplash onDone={() => setReady(true)} />}
      </AnimatePresence>
    </AppProviders>
  );
}

export default App;
