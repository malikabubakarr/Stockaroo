"use client";

import { useEffect, useRef } from "react";
import { auth } from "@/lib/firebase";
import { onIdTokenChanged, getIdToken } from "firebase/auth";

export default function SessionManager() {
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Function to refresh token
  const refreshToken = async () => {
    try {
      const user = auth.currentUser;
      if (user) {
        const token = await getIdToken(user, true);
        console.log("✅ Token refreshed at:", new Date().toLocaleTimeString());
        return token;
      }
    } catch (error) {
      console.error("❌ Token refresh failed:", error);
    }
    return null;
  };

  // Reset activity timeout
  const resetActivityTimeout = () => {
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
    }
    
    // Set a timeout to refresh token after 45 minutes of inactivity
    activityTimeoutRef.current = setTimeout(() => {
      console.log("⏰ Activity timeout - refreshing token");
      refreshToken();
    }, 45 * 60 * 1000); // 45 minutes
  };

  // Track user activity
  useEffect(() => {
    const events = ['mousedown', 'keydown', 'touchstart', 'click', 'scroll'];
    
    const handleActivity = () => {
      resetActivityTimeout();
    };
    
    events.forEach(event => {
      window.addEventListener(event, handleActivity);
    });
    
    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
    };
  }, []);

  // Set up token refresh on auth state change
  useEffect(() => {
    let isMounted = true;

    // Listen for auth state changes
    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (!isMounted) return;
      
      if (user) {
        console.log("👤 User authenticated:", user.email);
        
        // Clear any existing interval
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
        }
        
        // Refresh token every 30 minutes (safer than 45)
        refreshIntervalRef.current = setInterval(() => {
          console.log("🔄 Auto-refreshing auth token...");
          refreshToken();
        }, 30 * 60 * 1000); // 30 minutes
        
        // Initial refresh
        await refreshToken();
        resetActivityTimeout();
      } else {
        console.log("👤 No user authenticated");
        if (refreshIntervalRef.current) {
          clearInterval(refreshIntervalRef.current);
          refreshIntervalRef.current = null;
        }
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
    };
  }, []);

  // This component doesn't render anything
  return null;
}