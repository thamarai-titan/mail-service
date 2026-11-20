"use client";

import { useState } from "react";
import { useInboxes } from "../hooks/use-inboxes";
import { useLiveUpdates } from "../hooks/use-live-updates";
import type { InboxView } from "../lib/types";
import styles from "./dashboard.module.css";
import { EmailViewer } from "./email-viewer";
import { InboxSidebar } from "./inbox-sidebar";
import { MessageList } from "./message-list";

export function Dashboard() {
  const inboxesQuery = useInboxes();
  // Wait for the first successful request, which guarantees a session cookie for the stream.
  useLiveUpdates(inboxesQuery.isSuccess);
  const [selectedView, setSelectedView] = useState<InboxView>("unified");
  const [messageId, setMessageId] = useState<string | null>(null);

  const inboxes = inboxesQuery.data ?? [];
  // A selected inbox can expire or be deleted underneath us: fall back to the unified view.
  const selectedInbox = inboxes.find((inbox) => inbox.id === selectedView);
  const view: InboxView = selectedInbox ? selectedInbox.id : "unified";

  const selectView = (next: InboxView) => {
    setSelectedView(next);
    setMessageId(null);
  };

  return (
    <div className={styles.layout}>
      <InboxSidebar
        inboxes={inboxes}
        isLoading={inboxesQuery.isPending}
        error={inboxesQuery.error}
        view={view}
        onSelectView={selectView}
      />
      <MessageList
        view={view}
        title={selectedInbox ? selectedInbox.address : "All inboxes"}
        showInboxAddress={view === "unified"}
        hasInboxes={inboxes.length > 0}
        selectedMessageId={messageId}
        onSelectMessage={setMessageId}
      />
      <EmailViewer messageId={messageId} onClose={() => setMessageId(null)} />
    </div>
  );
}
