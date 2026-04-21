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
  orderBy,
  writeBatch,
  updateDoc,
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
  branchNumber: number;
  currency?: string;
  currencySymbol?: string;
  address?: string;
  phone?: string;
}

export default function BranchesPage() {
  const { setActiveBranch, activeBranch } = useBranch();

  const [ownerId, setOwnerId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerDoc, setOwnerDoc] = useState<any>(null);
  const [branchName, setBranchName] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState({ title: "", message: "", type: "success" });

  const router = useRouter();

  // Helper function for branches subcollection (user-centric)
  const getBranchesCollection = (userId: string) => {
    return collection(db, "users", userId, "branches");
  };

  // Show toast notification
  const showNotification = (title: string, message: string, type: "success" | "error" | "info" = "success") => {
    setToastMessage({ title, message, type });
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      const uid = user.uid;
      setOwnerId(uid);

      // Get owner document
      const ownerDocRef = doc(db, "users", uid);
      const ownerDocSnap = await getDoc(ownerDocRef);
      
      if (ownerDocSnap.exists()) {
        const ownerData = ownerDocSnap.data();
        setOwnerName(ownerData.name || ownerData.username || "Owner");
        setOwnerDoc(ownerData);
      } else {
        showNotification("Error", "Owner profile not found", "error");
        return;
      }

      // Load branches from user-centric subcollection
      const branchesRef = getBranchesCollection(uid);
      const q = query(
        branchesRef,
        orderBy("branchNumber", "asc")
      );

      const snap = await getDocs(q);

      const list: Branch[] = snap.docs.map((d) => ({
        id: d.id,
        branchNumber: d.data().branchNumber || 0,
        shopName: d.data().shopName,
        ownerId: d.data().ownerId,
        isMain: d.data().isMain || false,
        currency: d.data().currency || "PKR",
        currencySymbol: d.data().currencySymbol || "₨",
        address: d.data().address || "",
        phone: d.data().phone || "",
      }));

      // Sort by branch number
      list.sort((a, b) => a.branchNumber - b.branchNumber);
      setBranches(list);

      // Set active branch if not already set
      if (!activeBranch && list.length > 0) {
        const mainBranch = list.find((b) => b.isMain) || list[0];
        setActiveBranch({
          id: mainBranch.id,
          shopName: mainBranch.shopName,
          branchNumber: mainBranch.branchNumber,
          isMain: mainBranch.isMain,
          currency: mainBranch.currency || "PKR",
          currencySymbol: mainBranch.currencySymbol || "₨",
          ownerId: ""
        });
      }
    });

    return () => unsubscribe();
  }, [router, setActiveBranch, activeBranch]);

  const addBranch = async () => {
    if (!branchName.trim()) {
      showNotification("Missing Field", "Please enter branch name", "error");
      return;
    }

    setIsLoading(true);

    try {
      // Get next branch number
      const nextBranchNumber = branches.length + 1;
      const isFirstBranch = nextBranchNumber === 1;

      // Save branch under user-centric subcollection
      const branchesRef = getBranchesCollection(ownerId);
      
      const newBranchData = {
        shopName: branchName.trim(),
        ownerId,
        branchNumber: nextBranchNumber,
        isMain: isFirstBranch,
        currency: "PKR",
        currencySymbol: "₨",
        address: "",
        phone: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(branchesRef, newBranchData);

      // Update branch counter in user document
      const userDocRef = doc(db, "users", ownerId);
      await updateDoc(userDocRef, {
        branchCounter: nextBranchNumber,
        updatedAt: new Date(),
      });

      const newBranch: Branch = {
        id: docRef.id,
        shopName: branchName.trim(),
        ownerId,
        branchNumber: nextBranchNumber,
        isMain: isFirstBranch,
        currency: "PKR",
        currencySymbol: "₨",
      };

      setBranches((prev) => [...prev, newBranch].sort((a, b) => a.branchNumber - b.branchNumber));

      setBranchName("");

      showNotification(
        "Success!", 
        `Branch "${branchName}" added successfully as Branch #${nextBranchNumber}`, 
        "success"
      );

      // Auto-select the new branch
      setActiveBranch({
        id: newBranch.id,
        shopName: newBranch.shopName,
        branchNumber: newBranch.branchNumber,
        isMain: newBranch.isMain,
        currency: newBranch.currency || "PKR",
        currencySymbol: newBranch.currencySymbol || "₨",
        ownerId: ""
      });

      // Redirect to dashboard after 1 second
      setTimeout(() => {
        router.push("/owner-dashboard");
      }, 1000);

    } catch (error: any) {
      console.error("Error adding branch:", error);
      showNotification("Error", error.message || "Failed to add branch", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBranchClick = (branch: Branch) => {
    setActiveBranch({
      id: branch.id,
      shopName: branch.shopName,
      branchNumber: branch.branchNumber,
      isMain: branch.isMain,
      currency: branch.currency || "PKR",
      currencySymbol: branch.currencySymbol || "₨",
      ownerId: ""
    });
    localStorage.setItem("activeBranch", JSON.stringify(branch));
    router.push("/owner-dashboard");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6 flex flex-col items-center space-y-6">
      
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-4 right-4 z-50 animate-slide-in">
          <div className={`rounded-2xl shadow-2xl p-4 max-w-md backdrop-blur-xl border ${
            toastMessage.type === 'success' ? 'bg-green-50 border-green-200' :
            toastMessage.type === 'error' ? 'bg-red-50 border-red-200' :
            'bg-blue-50 border-blue-200'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`text-2xl ${
                toastMessage.type === 'success' ? 'text-green-600' :
                toastMessage.type === 'error' ? 'text-red-600' :
                'text-blue-600'
              }`}>
                {toastMessage.type === 'success' ? '✅' :
                 toastMessage.type === 'error' ? '❌' : 'ℹ️'}
              </div>
              <div className="flex-1">
                <h3 className={`font-bold ${
                  toastMessage.type === 'success' ? 'text-green-800' :
                  toastMessage.type === 'error' ? 'text-red-800' :
                  'text-blue-800'
                }`}>{toastMessage.title}</h3>
                <p className={`text-sm mt-1 ${
                  toastMessage.type === 'success' ? 'text-green-600' :
                  toastMessage.type === 'error' ? 'text-red-600' :
                  'text-blue-600'
                }`}>{toastMessage.message}</p>
              </div>
              <button
                onClick={() => setShowToast(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="text-center w-full max-w-md">
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
        <p className="text-gray-400 text-sm mt-1">Total Branches: {branches.length}</p>
      </div>

      <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-6 space-y-6 w-full max-w-md">
        <div>
          <label className="text-gray-300 text-sm mb-2 block">New Branch Name</label>
          <input
            placeholder="e.g., City Center Branch"
            className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && addBranch()}
            disabled={isLoading}
          />
          <p className="text-gray-500 text-xs mt-2">
            This will be Branch #{branches.length + 1}
          </p>
        </div>

        <button
          onClick={addBranch}
          disabled={isLoading || !branchName.trim()}
          className="w-full bg-gradient-to-r from-gray-900 to-gray-700 hover:from-gray-800 hover:to-gray-600 text-white p-3 rounded-lg font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Adding Branch...</span>
            </>
          ) : (
            `Add Branch #${branches.length + 1}`
          )}
        </button>

        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          <h3 className="text-white font-semibold text-lg border-b border-white/20 pb-2">Your Branches</h3>
          
          {branches.map((b) => (
            <div
              key={b.id}
              className="p-4 border border-white/20 rounded-xl flex justify-between items-center cursor-pointer hover:bg-white/5 transition-all duration-300 group"
              onClick={() => handleBranchClick(b)}
            >
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold group-hover:text-blue-300 transition">
                    {b.shopName}
                  </span>
                  {b.isMain && (
                    <span className="px-2 py-0.5 bg-yellow-500/20 border border-yellow-500 text-yellow-400 text-xs font-bold rounded-full">
                      MAIN
                    </span>
                  )}
                </div>
                <span className="text-gray-400 text-xs">
                  Branch #{b.branchNumber} • {b.currencySymbol || "₨"}{b.currency || "PKR"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {activeBranch?.id === b.id && (
                  <span className="px-2 py-1 bg-green-500/20 border border-green-500 text-green-400 text-xs font-bold rounded-full">
                    ACTIVE
                  </span>
                )}
                <svg className="w-5 h-5 text-gray-400 group-hover:text-white transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          ))}

          {branches.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              <div className="text-6xl mb-4">🏪</div>
              <p>No branches yet</p>
              <p className="text-sm mt-2">Add your first branch above</p>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}