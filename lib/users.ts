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

  alert("Employee added successfully!");
};