const UNKNOWN_APP_ID = "—";

/** Short "App #547" tag for an inbox row; null when the conversation has no known loan application. */
export function applicationLabel(application: { appId: string }): string | null {
  const id = application.appId.trim();
  return id === "" || id === UNKNOWN_APP_ID ? null : `App #${id}`;
}
