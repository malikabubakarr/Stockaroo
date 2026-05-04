// /lib/firebase.ts - Enhanced for 12hr Never-Logout PWA
import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getAuth, 
  setPersistence, 
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence
} from "firebase/auth";
import {
  getFirestore,
  enableIndexedDbPersistence,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  CACHE_SIZE_UNLIMITED,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBv5ruFqJIIW5oPDPQhCQZagstcrDFYODc",
  authDomain: "ministock-pos.firebaseapp.com",
  projectId: "ministock-pos",
  storageBucket: "ministock-pos.firebasestorage.app",
  messagingSenderId: "669416448921",
  appId: "1:669416448921:web:7c8df0e5bde98eeb7ea908",
};

// Prevent reinitializing Firebase in Next.js
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// 🚀 SUPERCHARGED Auth - 12hr+ Never-Logout
export const auth = getAuth(app);

// CRITICAL: PWA-SPECIFIC Persistence Strategy
if (typeof window !== "undefined") {
  // 1. Check if PWA/Standalone first (best for POS)
  const isPWA = window.matchMedia('(display-mode: standalone)').matches || 
                (navigator as any).standalone === true;
  
  setPersistence(auth, browserLocalPersistence)
    .then(() => {
      console.log(`✅ Auth persistence: ${isPWA ? 'PWA LOCAL (12hr+)' : 'LOCAL'} - Never logs out!`);
    })
    .catch((error) => {
      console.error("Auth persistence error:", error);
    });
}

// 🚀 ENHANCED Firestore - POS Optimized
let db: ReturnType<typeof getFirestore>;

if (typeof window !== "undefined") {
  try {
    // POS-OPTIMIZED Cache: Unlimited + Multi-tab sync
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
        cacheSizeBytes: CACHE_SIZE_UNLIMITED,
      }),
    });
    console.log("✅ Firestore: POS Offline Mode (Unlimited Cache + Tab Sync)");
  } catch (error) {
    console.warn("Firestore: Falling back to standard persistence");
    db = getFirestore(app);
    enableIndexedDbPersistence(db).catch((err) => {
      if (err.code === "failed-precondition") {
        console.log("Multiple tabs open, offline persistence disabled.");
      } else if (err.code === "unimplemented") {
        console.log("Browser doesn't support offline persistence.");
      }
    });
  }
} else {
  db = getFirestore(app);
}

export { db };