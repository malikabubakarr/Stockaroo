"use client";

import { useEffect } from "react";
import { extendPOSSession, restorePOSSession } from "@/lib/auth";

export default function GlobalSessionKeeper() {
  // 🚀 10min intervals + page lifecycle
  useEffect(() => {
    console.log("🔄 GlobalSessionKeeper: Starting 12hr session manager");
    
    // Restore immediately
    restorePOSSession();
    
    // Extend every 10 minutes
    const interval = setInterval(() => {
      const extended = extendPOSSession();
      console.log("⏰ Session extended:", extended ? "✅" : "❌");
    }, 10 * 60 * 1000); // 10 minutes

    // App foreground/background
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("📱 App foreground - extending session");
        extendPOSSession();
      }
    };

    // Tab focus
    const handleFocus = () => {
      console.log("🔍 Tab focused - extending session");
      extendPOSSession();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  // 🚀 Multi-tab sync
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "pos_session_12hr") {
        console.log("🔄 Tab sync: Session updated from another tab");
        restorePOSSession();
        window.dispatchEvent(new CustomEvent("session_synced"));
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  return null; // Invisible session magic ✨
}