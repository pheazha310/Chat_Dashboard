import { useEffect, useState } from "react";
import { ApplicationsPage, ChatPage } from "@/pages";
import { CustomerCallDialog } from "@/features/customer-call";
import { Toaster } from "@/shared/ui";
import { startRealtime } from "./providers/realtime";

export default function App() {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const teardown = startRealtime();
    return teardown;
  }, []);

  return (
    <>
      {expanded ? (
        <ApplicationsPage onClose={() => setExpanded(false)} />
      ) : (
        <ChatPage onExpand={() => setExpanded(true)} />
      )}
      <CustomerCallDialog />
      <Toaster />
    </>
  );
}
