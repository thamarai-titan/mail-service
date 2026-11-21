import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "templotus:notifications";

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function writePreference(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Storage can be blocked (private mode); the toggle then lasts for this page only.
  }
}

/**
 * Desktop notifications for new mail while the tab is in the background. Off until the
 * visitor turns them on; the browser asks for permission at that moment.
 */
export function useBrowserNotifications() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);

  // Read after mount: the server render cannot know the browser's permission.
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setSupported(true);
    setEnabled(readPreference() && Notification.permission === "granted");
  }, []);

  const toggle = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    if (enabled) {
      setEnabled(false);
      writePreference(false);
      return;
    }
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    const on = permission === "granted";
    setEnabled(on);
    writePreference(on);
  }, [enabled]);

  const notify = useCallback(
    (title: string, body: string) => {
      if (!enabled || !document.hidden) return;
      const notification = new Notification(title, {
        body,
        icon: "/favicon.ico",
        tag: "templotus-new-mail",
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    },
    [enabled],
  );

  return {
    supported,
    enabled,
    blocked: supported && !enabled && isDenied(),
    toggle,
    notify,
  };
}

function isDenied(): boolean {
  return (
    typeof Notification !== "undefined" && Notification.permission === "denied"
  );
}
