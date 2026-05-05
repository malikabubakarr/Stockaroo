"use client";

import { useEffect, useCallback } from "react";
import { extendPOSSession } from "@/lib/auth";

export default function SessionManager() {
  // 🚀 Activity-based extension (mousemove, touch, etc.)
  const extendOnActivity = useCallback(() => {
    extendPOSSession();
  }, []);

  useEffect(() => {
    console.log("🎮 SessionManager: Activity tracking started");

    // All activity events
    const events = [
      "mousemove",
      "mousedown",
      "mouseup", 
      "keydown",
      "scroll",
      "click",
      "touchstart",
      "touchmove"
    ];

    // Throttle activity events
    let activityTimeout: NodeJS.Timeout;
    const throttledExtend = () => {
      clearTimeout(activityTimeout);
      activityTimeout = setTimeout(extendOnActivity, 1000); // 1s debounce
    };

    events.forEach((event) => {
      document.addEventListener(event, throttledExtend, { passive: true });
    });

    // Initial extend
    extendOnActivity();

    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, throttledExtend);
      });
      clearTimeout(activityTimeout);
    };
  }, [extendOnActivity]);

  // 🚀 Listen for custom session events
  useEffect(() => {
    const handleSessionEvents = (e: Event) => {
      console.log("📨 Session event:", e.type);
      extendPOSSession();
    };

    window.addEventListener("pos_session_updated", handleSessionEvents);
    window.addEventListener("session_synced", handleSessionEvents);
    
    return () => {
      window.removeEventListener("pos_session_updated", handleSessionEvents);
      window.removeEventListener("session_synced", handleSessionEvents);
    };
  }, []);

  // 🚀 Before unload (PWA close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      console.log("🚪 App closing - session saved for 12hrs");
    };
    
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return null; // Invisible activity tracker 🎯
}