/**
 * Load-and-reload plumbing shared by every configuration tab.
 *
 * Each tab is the same shape: fetch on mount, show an error banner if the fetch
 * fails, mutate, then reload. `reload` is stable so it can be an effect
 * dependency, and `mutate` wraps a write so the tab does not repeat the
 * try/catch/toast/reload dance for each of its buttons.
 */

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@st-lucie/ui";

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    return (err as Error & { displayMessage?: string }).displayMessage ?? err.message;
  }
  return fallback;
}

export function useResource<T>(load: () => Promise<T>) {
  const notify = useToast();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (err) {
      setError(messageOf(err, "Load failed."));
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * Runs a write, then reloads. Returns true on success so callers can clear a
   * form only when the write actually landed.
   */
  const mutate = useCallback(
    async (action: () => Promise<unknown>, successMessage?: string): Promise<boolean> => {
      setSaving(true);
      try {
        await action();
        if (successMessage) notify("success", successMessage);
        await reload();
        return true;
      } catch (err) {
        notify("error", messageOf(err, "That change could not be saved."));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [notify, reload],
  );

  return { data, error, loading, saving, reload, mutate };
}
