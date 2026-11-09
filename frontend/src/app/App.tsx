import { useEffect, useRef, useState } from "react";
import { ApplicationsPage, ChatPage, LoginPage } from "@/pages";
import { CustomerCallDialog, LiveCallDialog } from "@/features/customer-call";
import { authRequired, startSessionKeeper, useAuthStore } from "@/shared/api/auth";
import { Toaster } from "@/shared/ui";
import { startRealtime } from "./providers/realtime";

export default function App() {
  const signedIn = useAuthStore((state) => state.user !== null);
  const wasSignedIn = useRef(signedIn);

  useEffect(() => startSessionKeeper(), []);

  useEffect(() => {
    // Signed out (here, in another tab, or because the session ended): start from a clean page, so nothing of the
    // previous user's inbox stays in memory for the next one.
    if (authRequired && wasSignedIn.current && !signedIn) window.location.reload();
    wasSignedIn.current = signedIn;
  }, [signedIn]);

  return (
    <>
      {authRequired && !signedIn ? <LoginPage /> : <Workspace />}
      <Toaster />
    </>
  );
}

/** The dashboard. Realtime starts only here, so it connects once someone is signed in. */
function Workspace() {
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
      <LiveCallDialog />
    </>
  );
}
