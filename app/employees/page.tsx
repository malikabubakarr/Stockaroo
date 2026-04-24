"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, collection, query, where, onSnapshot, setDoc, addDoc, serverTimestamp, getDocs } from "firebase/firestore";
import Link from "next/link";

interface Branch {
  id: string;
  shopName: string;
  ownerId: string;
  branchCode?: string;
  address?: string;
}

interface Employee {
  uid: string;
  name: string;
  email: string;
  role: string;
  ownerId: string;
  ownerName: string;
  branchId: string;
  branchName: string;
  createdAt: any;
  status: "active" | "inactive";
  employeeCode?: string;
}

export default function AddEmployee() {
  const [ownerName, setOwnerName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState({ title: "", message: "", type: "success" });

  // Helper function for owner's branches subcollection (user-centric)
  const getBranchesCollection = (ownerId: string) => {
    return collection(db, "users", ownerId, "branches");
  };

  // Helper function for employees subcollection (user-centric)
  const getEmployeesCollection = (ownerId: string) => {
    return collection(db, "users", ownerId, "employees");
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
        // Redirect to login if no user
        window.location.href = "/login";
        return;
      }

      const ownerId = user.uid;
      setOwnerId(ownerId);

      // Get owner's user document
      const userDoc = await getDoc(doc(db, "users", ownerId));
      
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.role !== "owner") {
          showNotification("Access Denied", "Only owners can add employees", "error");
          setTimeout(() => {
            window.location.href = "/";
          }, 2000);
          return;
        }
        setOwnerName(userData.username || userData.name || "Owner");
      } else {
        showNotification("Error", "Owner profile not found", "error");
        return;
      }

      // Load branches from user-centric structure: /users/{ownerId}/branches
      const branchesRef = getBranchesCollection(ownerId);
      const q = query(branchesRef);

      const unsubBranches = onSnapshot(q, (snap) => {
        const list = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        })) as Branch[];
        
        setBranches(list);
        
        if (list.length > 0 && !selectedBranch) {
          setSelectedBranch(list[0].id);
        }
      });

      return () => unsubBranches();
    });

    return () => unsubscribe();
  }, [selectedBranch]);

  const addEmployee = async () => {
    if (!name || !email || !password || !selectedBranch) {
      showNotification("Missing Fields", "Please fill all fields", "error");
      return;
    }

    if (password.length < 6) {
      showNotification("Invalid Password", "Password must be at least 6 characters", "error");
      return;
    }

    setIsLoading(true);

    try {
      // Check if employee with same email already exists in owner's employees collection
      const employeesRef = getEmployeesCollection(ownerId);
      const existingEmployeeQuery = query(employeesRef, where("email", "==", email));
      const existingEmployeeSnap = await getDocs(existingEmployeeQuery);
      
      if (!existingEmployeeSnap.empty) {
        showNotification("Duplicate Employee", "An employee with this email already exists", "error");
        setIsLoading(false);
        return;
      }

      // 1️⃣ Create Auth user for employee
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;
      
      const branch = branches.find(b => b.id === selectedBranch);
      
      if (!branch) {
        showNotification("Error", "Selected branch not found", "error");
        setIsLoading(false);
        return;
      }

      // Generate employee code
      const employeeCode = `EMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      
      // 2️⃣ Save employee data in owner's employees subcollection (User-centric)
      await addDoc(employeesRef, {
        uid: uid,
        name: name,
        email: email,
        role: "employee",
        ownerId: ownerId,
        ownerName: ownerName,
        branchId: selectedBranch,
        branchName: branch.shopName,
        employeeCode: employeeCode,
        status: "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      // 3️⃣ Create employee's own user document for login
      await setDoc(doc(db, "users", uid), {
        uid: uid,
        username: name,
        name: name,
        email: email,
        role: "employee",
        ownerId: ownerId,
        ownerName: ownerName,
        branchId: selectedBranch,
        branchName: branch.shopName,
        employeeCode: employeeCode,
        status: "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      showNotification("Success!", `Employee ${name} added successfully`, "success");
      
      // Reset form
      setName("");
      setEmail("");
      setPassword("");
      
    } catch (err: any) {
      console.error("Error adding employee:", err);
      
      if (err.code === "auth/email-already-in-use") {
        showNotification("Email In Use", "This email is already registered", "error");
      } else if (err.code === "auth/weak-password") {
        showNotification("Weak Password", "Password should be at least 6 characters", "error");
      } else {
        showNotification("Error", err.message || "Failed to add employee", "error");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Cool Header Section */}
      <div className="relative bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 text-white overflow-hidden border-b border-white/10">
        {/* Animated background elements */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 -left-4 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl animate-blob"></div>
          <div className="absolute top-0 -right-4 w-72 h-72 bg-yellow-500 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-2000"></div>
          <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-4000"></div>
        </div>
        
        <div className="relative px-6 py-8 md:py-10">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="bg-white/10 backdrop-blur-xl p-3 rounded-2xl">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-white via-gray-200 to-gray-300 bg-clip-text text-transparent">
                    Add Employee
                  </h1>
                  <p className="text-gray-300 mt-1 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    Create staff account for your branch
                  </p>
                </div>
              </div>
              
              <Link 
                href="/owner-dashboard" 
                className="group relative overflow-hidden bg-white/10 backdrop-blur-xl hover:bg-white/20 text-white px-5 py-2.5 rounded-xl transition-all duration-300 border border-white/20 flex items-center gap-2 w-fit"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:rotate-12 transition-transform" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM3 16a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" />
                </svg>
                <span className="font-medium">Dashboard</span>
              </Link>
            </div>
          </div>
        </div>
        
        {/* Curved bottom edge */}
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-t-3xl"></div>
      </div>

      {/* Main Content */}
      <div className="max-w-md mx-auto px-4 py-12">
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

        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl p-8 space-y-4">
          <div className="text-center text-gray-300 text-sm space-y-1 bg-white/5 rounded-lg p-3">
            <p>
              <span className="font-semibold text-white">Owner:</span> {ownerName || "Loading..."}
            </p>
            {selectedBranch && branches.length > 0 && (
              <p>
                <span className="font-semibold text-white">Selected Branch:</span>{" "}
                {branches.find(b => b.id === selectedBranch)?.shopName}
              </p>
            )}
          </div>

          {branches.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">🏪</div>
              <p className="text-gray-400">No branches found</p>
              <p className="text-xs text-gray-500 mt-2">
                Please create a branch first before adding employees
              </p>
              <Link 
                href="/add-branch"
                className="inline-block mt-4 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-all duration-300"
              >
                Add Branch
              </Link>
            </div>
          ) : (
            <>
              <select
                className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none focus:ring-2 focus:ring-white/30 transition-all duration-300"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                disabled={isLoading}
              >
                {branches.map(branch => (
                  <option key={branch.id} value={branch.id} className="text-black">
                    {branch.shopName} {branch.branchCode ? `(${branch.branchCode})` : ''}
                  </option>
                ))}
              </select>

              <input
                placeholder="Employee Name"
                className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all duration-300"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isLoading}
              />

              <input
                placeholder="Email Address"
                type="email"
                className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all duration-300"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />

              <input
                placeholder="Password (min. 6 characters)"
                type="password"
                className="w-full p-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all duration-300"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />

              <button
                onClick={addEmployee}
                disabled={isLoading || branches.length === 0}
                className="w-full bg-gradient-to-r from-gray-900 to-gray-700 hover:from-gray-800 hover:to-gray-600 text-white p-3 rounded-lg font-semibold shadow-xl transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Adding Employee...</span>
                  </>
                ) : (
                  "Add Employee"
                )}
              </button>
            </>
          )}
        </div>

        <div className="mt-6 text-center text-xs text-gray-500">
          <p>Employee will have access to:</p>
          <p className="mt-1">• View products for assigned branch</p>
          <p>• Create sales for customers</p>
          <p>• View their own sales reports</p>
        </div>
      </div>

      <style jsx global>{`
        @keyframes blob {
          0% {
            transform: translate(0px, 0px) scale(1);
          }
          33% {
            transform: translate(30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
          100% {
            transform: translate(0px, 0px) scale(1);
          }
        }
        
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
        
        .animate-blob {
          animation: blob 7s infinite;
        }
        
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        
        .animation-delay-4000 {
          animation-delay: 4s;
        }
        
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}