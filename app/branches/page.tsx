"use client";

import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { useBranch } from "@/context/BranchContext";
import Link from "next/link";

interface Branch {
  id: string;
  shopName: string;
  ownerId: string;
  isMain?: boolean;
  branchNumber?: number;
  currency?: string;
  currencySymbol?: string;
}

export default function BranchesPage() {
  const { setActiveBranch } = useBranch();

  const [ownerId, setOwnerId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);

  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) return;

      setOwnerId(user.uid);

      const ownerDoc = await getDoc(doc(db, "users", user.uid));
      if (ownerDoc.exists()) {
        setOwnerName(ownerDoc.data().name || "Owner");
      }

      // 🔹 Load branches from branches collection
      const q = query(
        collection(db, "branches"),
        where("ownerId", "==", user.uid)
      );

      const snap = await getDocs(q);

      const list: Branch[] = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as Branch[];

      list.sort((a, b) => (a.branchNumber || 0) - (b.branchNumber || 0));

      setBranches(list);

      if (list.length > 0) {
        const main = list.find((b) => b.isMain) || list[0];

        setActiveBranch({
          ...main,
          currency: main.currency || "PKR",
          currencySymbol: main.currencySymbol || "₨",
        });
      }
    });

    return () => unsubscribe();
  }, [setActiveBranch]);

  const addBranch = async () => {
    if (!branchName) {
      alert("Enter Branch Name");
      return;
    }

    const branchNumber = branches.length + 1;
    const isFirstBranch = branchNumber === 1;

    const docRef = await addDoc(collection(db, "branches"), {
      shopName: branchName,
      ownerId,
      branchNumber,
      isMain: isFirstBranch,
      currency: "PKR",
      currencySymbol: "₨",
      createdAt: serverTimestamp(),
    });

    const newBranch: Branch = {
      id: docRef.id,
      shopName: branchName,
      ownerId,
      branchNumber,
      isMain: isFirstBranch,
      currency: "PKR",
      currencySymbol: "₨",
    };

    setBranches((prev) => [...prev, newBranch]);

    setBranchName("");

    setActiveBranch({
      ...newBranch,
      currency: newBranch.currency || "PKR",
      currencySymbol: newBranch.currencySymbol || "₨",
    });

    alert("Branch added successfully!");

    router.push("/owner-dashboard");
  };

  return (
    
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6 flex flex-col items-center space-y-6">

      <div className="text-center">
        {/* Dashboard Button */}
<div className="mb-4 text-right">
<Link 
href="/owner-dashboard" 
className="inline-flex items-center px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all duration-300 border border-white/20 backdrop-blur-sm"
>
<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
<path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM3 16a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" />
</svg>
Dashboard
</Link>
</div>
        <h1 className="text-3xl font-bold text-white">Branches</h1>
        <p className="text-gray-300">Owner: {ownerName}</p>
      </div>

      <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-6 space-y-6 w-full max-w-md">

        <input
          placeholder="New Branch Name"
          className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
        />

        <button
          onClick={addBranch}
          className="w-full bg-gradient-to-r from-gray-900 to-gray-700 text-white p-3 rounded-lg font-semibold"
        >
          Add Branch
        </button>

        <div className="space-y-3">

          {branches.map((b) => (
            <div
              key={b.id}
              className="p-4 border border-white/20 rounded-xl flex justify-between items-center"
              onClick={() => {
                setActiveBranch({
                  ...b,
                  currency: b.currency || "PKR",
                  currencySymbol: b.currencySymbol || "₨",
                });
                router.push("/owner-dashboard");
              }}
            >
              <div className="flex flex-col">

                <span className="text-white font-semibold">
                  {b.shopName}
                </span>

                <span className="text-gray-400 text-xs">
                  Branch {b.branchNumber}
                </span>

              </div>

              {b.isMain && (
                <span className="px-3 py-1 bg-green-500/20 border border-green-500 text-green-400 text-xs font-bold rounded-full">
                  MAIN
                </span>
              )}
            </div>
          ))}

        </div>

      </div>

    </div>
  );
}