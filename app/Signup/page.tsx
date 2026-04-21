"use client";

import { useState } from "react";
import { auth, db } from "@/lib/firebase";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, collection, addDoc, writeBatch } from "firebase/firestore";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shop, setShop] = useState("");
  const [loading, setLoading] = useState(false);

  const router = useRouter();

  const signup = async () => {
    try {
      if (!name || !email || !password || !shop) {
        alert("Please fill all fields");
        return;
      }

      if (password.length < 6) {
        alert("Password must be at least 6 characters");
        return;
      }

      setLoading(true);

      // Create user in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      // Use batch for atomic operations
      const batch = writeBatch(db);

      // 1. Create user document with all user data
      const userDocRef = doc(db, "users", uid);
      batch.set(userDocRef, {
        uid: uid,
        name: name,
        email: email,
        role: "owner",
        createdAt: new Date(),
        shopName: shop,
        currency: "PKR",
        currencySymbol: "₨",
        invoicePrefix: "INV",
        branchCounter: 1, // Track number of branches
      });

      // 2. Create MAIN BRANCH (Branch #1) under user's branches subcollection
      const branchesRef = collection(db, "users", uid, "branches");
      const mainBranchRef = doc(branchesRef); // Create document reference
      
      batch.set(mainBranchRef, {
        shopName: shop,
        isMain: true,
        isActive: true,
        branchNumber: 1, // First branch is #1
        currency: "PKR",
        currencySymbol: "₨",
        address: "",
        phone: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 3. Store the main branch ID in user document
      batch.update(userDocRef, {
        mainBranchId: mainBranchRef.id,
      });

      // 4. Create default categories under user's categories subcollection
      const categoriesRef = collection(db, "users", uid, "categories");
      const defaultCategories = [
        "Electronics", "Clothing", "Food & Beverages", "Furniture", 
        "Stationery", "Cosmetics", "Sports", "Toys", "Other"
      ];
      
      for (const category of defaultCategories) {
        const categoryRef = doc(categoriesRef);
        batch.set(categoryRef, {
          name: category,
          isActive: true,
          createdAt: new Date(),
        });
      }

      // 5. Create default tax settings under user's settings subcollection
      const settingsRef = doc(db, "users", uid, "settings", "general");
      batch.set(settingsRef, {
        defaultTaxRate: 0,
        invoiceFooter: "Thank you for your business!",
        currency: "PKR",
        currencySymbol: "₨",
        dateFormat: "DD/MM/YYYY",
        createdAt: new Date(),
      });

      // Commit all writes
      await batch.commit();

      // Store owner info in localStorage for quick access
      localStorage.setItem("userRole", "owner");
      localStorage.setItem("ownerId", uid);
      localStorage.setItem("ownerName", name);
      
      // Set active branch in localStorage
      const mainBranchData = {
        id: mainBranchRef.id,
        shopName: shop,
        branchNumber: 1,
        isMain: true,
        currency: "PKR",
        currencySymbol: "₨"
      };
      localStorage.setItem("activeBranch", JSON.stringify(mainBranchData));

      router.push("/owner-dashboard");

    } catch (error: any) {
      console.error("Signup error:", error);
      
      if (error.code === "auth/email-already-in-use") {
        alert("Email already in use. Please use a different email or login.");
      } else if (error.code === "auth/weak-password") {
        alert("Password is too weak. Please use at least 6 characters.");
      } else {
        alert(error.message || "Failed to create account. Please try again.");
      }
    } finally {
      setLoading(false);
    }
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
            Create your shop account
          </p>
        </div>

        {/* Card */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-8 space-y-4">
          <input
            placeholder="Owner Name"
            className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:border-white/40 transition-all"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={loading}
          />

          <input
            placeholder="Email"
            type="email"
            className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:border-white/40 transition-all"
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={loading}
          />

          <input
            placeholder="Password (min. 6 characters)"
            type="password"
            className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:border-white/40 transition-all"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={loading}
          />

          <input
            placeholder="Main Shop Name"
            className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:border-white/40 transition-all"
            value={shop}
            onChange={e => setShop(e.target.value)}
            disabled={loading}
          />

          <button
            onClick={signup}
            disabled={loading}
            className="w-full bg-gradient-to-r from-gray-900 to-gray-700 hover:from-gray-800 hover:to-gray-600 text-white p-3 rounded-lg font-semibold shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Creating Account..." : "Create Shop"}
          </button>
        </div>

        <p className="text-center text-gray-400 text-sm mt-6">
          Already have an account?  
          <span
            onClick={() => router.push("/login")}
            className="text-white ml-2 cursor-pointer hover:underline"
          >
            Login
          </span>
        </p>
      </div>
    </div>
  );
}