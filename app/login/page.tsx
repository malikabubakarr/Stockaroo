"use client";

import { useState } from "react";
import { auth, db } from "@/lib/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useBranch } from "@/context/BranchContext";
import Image from "next/image";

export default function LoginPage() {

const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
const [loading, setLoading] = useState(false);

const router = useRouter();
const { setActiveBranch } = useBranch();

const login = async () => {

if (!email || !password) return alert("Enter email and password");

try {

setLoading(true);

const userCredential = await signInWithEmailAndPassword(auth, email, password);
const uid = userCredential.user.uid;

// ---------- CHECK USERS COLLECTION ----------
const userDocRef = doc(db, "users", uid);
const userSnap = await getDoc(userDocRef);

if (userSnap.exists()) {

const userData = userSnap.data();

// OWNER LOGIN
if (userData.role === "owner") {

const branchQuery = query(
collection(db, "branches"),
where("ownerId", "==", uid),
where("isMain", "==", true)
);

const branchSnap = await getDocs(branchQuery);

if (branchSnap.empty) {
alert("No main branch found for this owner");
setLoading(false);
return;
}

const branchDoc = branchSnap.docs[0];
const branchData = branchDoc.data();

const mainBranch = {
id: branchDoc.id,
shopName: branchData.shopName,
ownerId: branchData.ownerId,
...branchData,
currency: branchData.currency ?? "",
currencySymbol: branchData.currencySymbol ?? ""
};

setActiveBranch(mainBranch);

router.push("/owner-dashboard");
return;
}

}

// ---------- CHECK EMPLOYEE ----------
const empQuery = query(
collection(db, "employees"),
where("uid", "==", uid)
);

const empSnap = await getDocs(empQuery);

if (!empSnap.empty) {

const empDoc = empSnap.docs[0];
const empData = empDoc.data();

const branchRef = doc(db, "branches", empData.branchId);
const branchSnap = await getDoc(branchRef);

if (!branchSnap.exists()) {
alert("Branch not found for employee");
setLoading(false);
return;
}

const branchData = branchSnap.data();

setActiveBranch({
id: empData.branchId,
shopName: branchData.shopName,
ownerId: branchData.ownerId,
...branchData,
currency: "",
currencySymbol: ""
});

router.push("/employee-dashboard");
return;

}

alert("Account not registered in system");

} catch (err:any) {

console.error(err);
alert(err.message || "Login failed");

}

setLoading(false);

};

return (

<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 px-4">

<div className="w-full max-w-md">

{/* Logo */}
<div className="flex flex-col items-center mb-8">

<Image
src="/stockaro-logo.png"
alt="Stockaroo"
width={70}
height={70}
className="rounded-xl shadow-xl"
/>

<h1 className="text-3xl font-bold text-white mt-3 tracking-tight">
Stockaroo
</h1>

<p className="text-gray-400 text-sm">
Sign in to your account
</p>

</div>

{/* Card */}
<div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-8 space-y-4">

<input
type="email"
placeholder="Email"
className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:border-white/40"
value={email}
onChange={(e)=>setEmail(e.target.value)}
/>

<input
type="password"
placeholder="Password"
className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:border-white/40"
value={password}
onChange={(e)=>setPassword(e.target.value)}
/>

<button
onClick={login}
disabled={loading}
className="w-full bg-gradient-to-r from-gray-900 to-gray-700 hover:from-gray-800 hover:to-gray-600 text-white p-3 rounded-lg font-semibold shadow-xl transition-all duration-300"
>
{loading ? "Signing in..." : "Login"}
</button>

</div>

<p className="text-center text-gray-400 text-sm mt-6">

Don't have an account?

<span
onClick={()=>router.push("/signup")}
className="text-white ml-2 cursor-pointer hover:underline"
>
Create one
</span>

</p>

</div>

</div>

);
}