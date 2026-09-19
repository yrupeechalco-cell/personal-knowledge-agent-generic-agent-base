import { useEffect } from "react";
import { isTypeWordsEnabled, type TypeWordsAdapter } from "./typewords";

/** Prepare the service at App launch without loading an iframe or stealing the active tab. */
export function TypeWordsStartup({ adapter }: { adapter?: TypeWordsAdapter }) {
  useEffect(() => {
    if (adapter && isTypeWordsEnabled()) {
      // The plugin page repeats the readiness check and displays recoverable startup errors.
      void adapter.ensureStarted().catch(() => {});
    }
  }, [adapter]);
  return null;
}
