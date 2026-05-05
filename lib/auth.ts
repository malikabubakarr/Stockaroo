// lib/auth.ts - SERVER SAFE VERSION
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export const login = async (email: string, password: string) => {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  const uid = userCredential.user.uid;
  const userDoc = await getDoc(doc(db, "users", uid));
  const userData = userDoc.data();

  if (!userData) throw new Error("User not found");

  // 🚀 Create 12hr session (client-side only)
  if (typeof window !== "undefined") {
    createPOSSession(uid, userData);
  }

  return { uid, role: userData.role, branchId: userData.branchId };
};

// 🚀 SERVER-SAFE 12hr Session Functions
const SESSION_KEY = "pos_session_12hr";
const SESSION_DURATION = 12 * 60 * 60 * 1000; // 12 hours

export const createPOSSession = (uid: string, userData: any) => {
  if (typeof window === "undefined") return; // Server-safe
  
  const session = {
    uid,
    role: userData.role,
    branchId: userData.branchId,
    name: userData.username || userData.name || 'Unknown',
    startTime: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION,
    lastActivity: Date.now()
  };
  
  // Multiple storage for PWA reliability
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  
  // Broadcast to other tabs
  window.dispatchEvent(new CustomEvent('pos_session_updated', { detail: session }));
};

export const restorePOSSession = (): any | null => {
  if (typeof window === "undefined") return null; // Server-safe
  
  // Try localStorage first
  let sessionStr = localStorage.getItem(SESSION_KEY);
  
  // Fallback to sessionStorage
  if (!sessionStr) {
    sessionStr = sessionStorage.getItem(SESSION_KEY);
  }

  if (!sessionStr) return null;

  try {
    const session = JSON.parse(sessionStr);
    if (Date.now() < session.expiresAt) {
      session.lastActivity = Date.now();
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      window.dispatchEvent(new CustomEvent('pos_session_updated', { detail: session }));
      return session;
    } else {
      clearPOSSession();
      return null;
    }
  } catch {
    clearPOSSession();
    return null;
  }
};

export const extendPOSSession = () => {
  if (typeof window === "undefined") return false; // Server-safe
  
  const sessionStr = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
  if (!sessionStr) return false;

  try {
    const session = JSON.parse(sessionStr);
    if (Date.now() < session.expiresAt) {
      session.lastActivity = Date.now();
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      window.dispatchEvent(new CustomEvent('pos_session_updated', { detail: session }));
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

export const clearPOSSession = () => {
  if (typeof window === "undefined") return; // Server-safe
  
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent('pos_session_cleared'));
};

// 🚀 CLIENT-ONLY: Multi-tab sync (moved from bottom)
if (typeof window !== "undefined") {
  window.addEventListener('storage', (e) => {
    if (e.key === SESSION_KEY) {
      window.location.reload(); // Sync across tabs
    }
  });
}