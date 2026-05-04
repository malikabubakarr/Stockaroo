// /lib/auth.ts
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export const login = async (email: string, password: string) => {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  const uid = userCredential.user.uid;
  const userDoc = await getDoc(doc(db, "users", uid));
  const userData = userDoc.data();

  if (!userData) throw new Error("User not found");

  // 🚀 NEW: Create 12hr session (doesn't change your return value)
  createPOSSession(uid, userData);

  return { uid, role: userData.role, branchId: userData.branchId };
};

// 🚀 NEW: 12hr Never-Logout Functions
const SESSION_KEY = "pos_session_12hr";
const SESSION_DURATION = 12 * 60 * 60 * 1000; // 12 hours

const createPOSSession = (uid: string, userData: any) => {
  const session = {
    uid,
    role: userData.role,
    branchId: userData.branchId,
    name: userData.username || userData.name || 'Unknown',
    startTime: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION,
    lastActivity: Date.now()
  };
  
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export const restorePOSSession = (): any | null => {
  const sessionStr = localStorage.getItem(SESSION_KEY);
  if (!sessionStr) return null;

  try {
    const session = JSON.parse(sessionStr);
    if (Date.now() < session.expiresAt) {
      session.lastActivity = Date.now();
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return session;
    } else {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
};

export const extendPOSSession = () => {
  const sessionStr = localStorage.getItem(SESSION_KEY);
  if (!sessionStr) return false;

  try {
    const session = JSON.parse(sessionStr);
    if (Date.now() < session.expiresAt) {
      session.lastActivity = Date.now();
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

export const clearPOSSession = () => {
  localStorage.removeItem(SESSION_KEY);
};