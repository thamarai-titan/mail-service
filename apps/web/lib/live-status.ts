import { useSyncExternalStore } from "react";

/** "live" while the event stream is open; lists fall back to slow polling otherwise. */
export type LiveStatus = "connecting" | "live" | "offline";

let status: LiveStatus = "connecting";
const listeners = new Set<() => void>();

export function setLiveStatus(next: LiveStatus): void {
  if (next === status) return;
  status = next;
  for (const notify of listeners) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => "connecting",
  );
}

/** How often lists refresh while the event stream is down. */
export const FALLBACK_POLL_MS = 30_000;
