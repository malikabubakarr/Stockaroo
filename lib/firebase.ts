// /lib/firebase.ts

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  enableIndexedDbPersistence,
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

// Firebase Auth
export const auth = getAuth(app);

// Firestore
export const db = getFirestore(app);

// Enable offline cache ONLY in browser
if (typeof window !== "undefined") {
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === "failed-precondition") {
      console.log("Multiple tabs open, offline persistence disabled.");
    } else if (err.code === "unimplemented") {
      console.log("Browser doesn't support offline persistence.");
    }
  });
}