"use client";

import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { 
  signInWithEmailAndPassword, 
  setPersistence, 
  browserLocalPersistence,
  onAuthStateChanged 
} from "firebase/auth";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useBranch } from "@/context/BranchContext";
import Image from "next/image";

export default function LoginPage() {

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const router = useRouter();
  const { setActiveBranch } = useBranch();

  // 🔥 Check if user is already logged in (persistent session)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // User is already logged in, redirect to appropriate dashboard
        const uid = user.uid;
        
        try {
          // Check if user is owner
          const userDocRef = doc(db, "users", uid);
          const userSnap = await getDoc(userDocRef);
          
          if (userSnap.exists()) {
            const userData = userSnap.data();
            
            if (userData.role === "owner") {
              // Owner login - redirect to owner dashboard
              const branchQuery = query(
                collection(db, "branches"),
                where("ownerId", "==", uid),
                where("isMain", "==", true)
              );
              
              const branchSnap = await getDocs(branchQuery);
              
              if (!branchSnap.empty) {
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
          }
          
          // Check if user is employee
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
            
            if (branchSnap.exists()) {
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
          }
        } catch (error) {
          console.error("Error checking existing session:", error);
        }
      }
      
      setCheckingAuth(false);
    });
    
    return () => unsubscribe();
  }, [router, setActiveBranch]);

  const login = async () => {
    if (!email || !password) {
      alert("Enter email and password");
      return;
    }

    try {
      setLoading(true);

      // 🔥 CRITICAL: Set persistence to LOCAL before signing in
      // This keeps the user logged in even after closing the browser
      await setPersistence(auth, browserLocalPersistence);
      
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
          
          // Store login info in localStorage for additional persistence
          localStorage.setItem("lastLoggedIn", new Date().toISOString());
          localStorage.setItem("userRole", "owner");
          
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
        
        // Store login info in localStorage for additional persistence
        localStorage.setItem("lastLoggedIn", new Date().toISOString());
        localStorage.setItem("userRole", "employee");
        
        router.push("/employee-dashboard");
        return;
      }

      alert("Account not registered in system");

    } catch (err: any) {
      console.error(err);
      alert(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  // Show loading screen while checking auth
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent mx-auto mb-4"></div>
          <p className="text-white">Checking session...</p>
        </div>
      </div>
    );
  }

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
            className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:border-white/40 transition-all"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && login()}
          />

          <input
            type="password"
            placeholder="Password"
            className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:border-white/40 transition-all"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && login()}
          />

          <button
            onClick={login}
            disabled={loading}
            className="w-full bg-gradient-to-r from-gray-900 to-gray-700 hover:from-gray-800 hover:to-gray-600 text-white p-3 rounded-lg font-semibold shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in..." : "Login"}
          </button>
          
          {/* Info about persistent login */}
          <p className="text-xs text-gray-400 text-center mt-2">
            🔒 You'll stay logged in until you sign out
          </p>
        </div>

        <p className="text-center text-gray-400 text-sm mt-6">
          Don't have an account?
          <span
            onClick={() => router.push("/signupp")}
            className="text-white ml-2 cursor-pointer hover:underline"
          >
            Create one
          </span>
        </p>
      </div>
    </div>
  );
}