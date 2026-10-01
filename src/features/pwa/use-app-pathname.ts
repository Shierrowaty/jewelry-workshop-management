"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};
const currentPath = () => window.location.pathname;
const serverPath = () => "";

// A cached /offline document retains its Next route tree. Use the requested URL
// for its content and navigation highlight, without changing the online router.
export function useAppPathname() {
  const nextPath = usePathname();
  const browserPath = useSyncExternalStore(subscribe, currentPath, serverPath);
  // Keep the first render independent of the URL: the same static HTML may
  // be served for any local quote URL. Reveal route labels after hydration.
  return browserPath ? (nextPath === "/offline" ? browserPath : nextPath) : "";
}
