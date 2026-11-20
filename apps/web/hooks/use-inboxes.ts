import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Inbox } from "../lib/types";
import { FALLBACK_POLL_MS, useLiveStatus } from "../lib/live-status";

export const INBOXES_KEY = ["inboxes"] as const;
export const MAX_ACTIVE_INBOXES = 10;
export const MAX_PER_REQUEST = 5;

export function useInboxes() {
  const live = useLiveStatus() === "live";
  return useQuery({
    queryKey: INBOXES_KEY,
    queryFn: async () =>
      (await api<{ inboxes: Inbox[] }>("GET", "/inboxes")).inboxes,
    // The event stream announces changes; poll slowly only while it is down.
    refetchInterval: live ? false : FALLBACK_POLL_MS,
  });
}

export function useCreateInboxes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (count: number) =>
      (await api<{ inboxes: Inbox[] }>("POST", "/inboxes", { count })).inboxes,
    onSuccess: (created) => {
      queryClient.setQueryData<Inbox[]>(INBOXES_KEY, (current = []) => [
        ...created,
        ...current,
      ]);
    },
  });
}

export function useExtendInbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Inbox>("PATCH", `/inboxes/${id}/extend`),
    onSuccess: (extended) => {
      queryClient.setQueryData<Inbox[]>(INBOXES_KEY, (current = []) =>
        current.map((inbox) => (inbox.id === extended.id ? extended : inbox)),
      );
    },
  });
}

export function useDeleteInbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/inboxes/${id}`),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<Inbox[]>(INBOXES_KEY, (current = []) =>
        current.filter((inbox) => inbox.id !== id),
      );
      // Its messages disappear from the unified view too. The deleted inbox's own list is left
      // alone: refetching it would only produce a 404.
      void queryClient.invalidateQueries({ queryKey: ["messages", "unified"] });
    },
  });
}
