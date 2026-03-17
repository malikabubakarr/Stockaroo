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

  return { uid, role: userData.role, branchId: userData.branchId };
};