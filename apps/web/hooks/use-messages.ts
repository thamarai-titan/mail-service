import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "../lib/api";
import type { InboxView, MessageDetail, MessagePage } from "../lib/types";
import { INBOXES_KEY, POLL_INTERVAL_MS } from "./use-inboxes";

const MESSAGES_KEY = ["messages"] as const;

/** One page-by-page list per view: the unified inbox or a single inbox. */
export function useMessages(view: InboxView) {
  return useInfiniteQuery({
    queryKey: [...MESSAGES_KEY, view],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(
        view === "unified" ? { view: "unified" } : { inboxId: view },
      );
      if (pageParam) params.set("cursor", pageParam);
      return api<MessagePage>("GET", `/messages?${params.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchInterval: POLL_INTERVAL_MS,
  });
}

/** Loads a full message. The API marks it read, so the cached lists and badges are updated to match. */
export function useMessage(id: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["message", id],
    enabled: id !== null,
    // The body never changes once stored; do not refetch it on focus or remount.
    staleTime: Infinity,
    queryFn: async () => {
      const message = await api<MessageDetail>("GET", `/messages/${id}`);
      queryClient.setQueriesData<InfiniteData<MessagePage>>(
        { queryKey: MESSAGES_KEY },
        (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  messages: page.messages.map((summary) =>
                    summary.id === message.id
                      ? { ...summary, isRead: true }
                      : summary,
                  ),
                })),
              }
            : data,
      );
      void queryClient.invalidateQueries({ queryKey: INBOXES_KEY });
      return message;
    },
  });
}

export function useDeleteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/messages/${id}`),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: ["message", id] });
      void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY });
      void queryClient.invalidateQueries({ queryKey: INBOXES_KEY });
    },
  });
}
