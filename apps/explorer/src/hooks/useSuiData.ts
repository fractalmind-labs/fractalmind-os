import { useState, useEffect, useCallback } from "react";
import type { ExplorerData } from "../sui/types.ts";
import { fetchAllData } from "../sui/queries.ts";

const EMPTY: ExplorerData = {
  organizations: [],
  agents: [],
  tasks: [],
  peers: [],
  loading: true,
  error: null,
};

export function useSuiData(pollInterval = 30_000): ExplorerData & { refresh: () => void } {
  const [data, setData] = useState<ExplorerData>(EMPTY);

  const load = useCallback(async () => {
    try {
      setData((prev) => ({ ...prev, loading: true, error: null }));
      const result = await fetchAllData();
      setData({ ...result, loading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setData((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, pollInterval);
    return () => clearInterval(interval);
  }, [load, pollInterval]);

  return { ...data, refresh: load };
}
