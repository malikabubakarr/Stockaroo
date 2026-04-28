// /lib/firebase.ts

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

// Firebase Auth with PERSISTENT login
export const auth = getAuth(app);

// CRITICAL: Set persistence to LOCAL so user stays logged in
// This prevents logout when closing the app or after inactivity
if (typeof window !== "undefined") {
  setPersistence(auth, browserLocalPersistence)
    .then(() => {
      console.log("Auth persistence set to LOCAL - user will stay logged in");
    })
    .catch((error) => {
      console.error("Auth persistence error:", error);
    });
}

// Firestore with enhanced offline persistence
let db: ReturnType<typeof getFirestore>;

if (typeof window !== "undefined") {
  try {
    // Enhanced offline persistence - better for slow/unstable internet
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
        cacheSizeBytes: CACHE_SIZE_UNLIMITED, // Cache everything possible
      }),
    });
    console.log("Firestore: Enhanced offline persistence enabled");
  } catch (error) {
    // Fallback to standard Firestore if enhanced fails
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
  // Server-side
  db = getFirestore(app);
}

export { db };