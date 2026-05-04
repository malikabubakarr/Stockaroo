// /lib/users.ts
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export const addEmployee = async (name: string, email: string, password: string, branchId: string) => {
  // 1️⃣ Create Auth user
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const uid = userCredential.user.uid;

  // 2️⃣ Save user data in Firestore
  await setDoc(doc(db, "users", uid), {
    username: name,
    role: "employee",
    branchId: branchId,
  });

  // 🚀 NEW: Auto-create 12hr session for new employee (optional)
  createPOSSessionForEmployee(uid, name, branchId);

  alert("Employee added successfully!");
};

// 🚀 NEW: Helper for employee sessions (matches auth.ts)
const createPOSSessionForEmployee = (uid: string, name: string, branchId: string) => {
  const SESSION_KEY = "pos_session_12hr";
  const SESSION_DURATION = 12 * 60 * 60 * 1000;
  
  const session = {
    uid,
    role: "employee",
    branchId,
    name,
    startTime: Date.now(),
    expiresAt: Date.now() + SESSION_DURATION,
    lastActivity: Date.now()
  };
  
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  console.log("✅ Employee 12hr session auto-created");
};