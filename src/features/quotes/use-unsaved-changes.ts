"use client";

import { useEffect, useRef } from "react";

export function useUnsavedChanges(dirty: boolean, message = "Masz niezapisane zmiany w realizacji. Wyjść bez zapisu?") {
  const bypass = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      if (bypass.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function followLink(event: MouseEvent) {
      if (bypass.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      // Full document/external navigations use beforeunload; cover Next links separately.
      if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname && destination.search === window.location.search) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", followLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", followLink, true);
    };
  }, [dirty, message]);
  // Permit the programmatic redirect only after a successful local transaction.
  return () => { bypass.current = true; };
}
