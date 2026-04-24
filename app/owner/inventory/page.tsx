"use client";

import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useBranch } from "@/context/BranchContext";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";

interface Product {
  id: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  minStock: number;
  purchaseRate: number;
  saleRate: number;
  profit: number;
  allowSale: boolean;
  barcode?: string | number;
}

export default function InventoryPage() {
  const { activeBranch } = useBranch();

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Helper function for user-centric products collection
  const getProductsCollection = (userId: string) => {
    return collection(db, "users", userId, "products");
  };

  // Detect offline / online
  useEffect(() => {
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Get current user's ownerId
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setOwnerId(user.uid);
      }
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // ✅ UPDATED: Load products from user-centric subcollection
  useEffect(() => {
    if (!activeBranch?.id || !ownerId) return;

    const productsRef = getProductsCollection(ownerId);
    const q = query(
      productsRef,
      where("branchId", "==", activeBranch.id)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const list: Product[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          name: data.name,
          category: data.category,
          unit: data.unit,
          qty: data.qty,
          minStock: data.minStock,
          purchaseRate: data.purchaseRate,
          saleRate: data.saleRate,
          profit: data.profit,
          allowSale: data.allowSale,
          barcode: data.barcode ? String(data.barcode) : "",
        };
      }) as Product[];

      setProducts(list);
    });

    return () => unsub();
  }, [activeBranch, ownerId]);

  // Search & sort - includes barcode search
  let filtered = products.filter((p) => {
    const searchLower = search.toLowerCase();
    const nameMatch = p.name ? p.name.toLowerCase().includes(searchLower) : false;
    const categoryMatch = p.category ? p.category.toLowerCase().includes(searchLower) : false;
    
    // Safe barcode check
    let barcodeMatch = false;
    if (p.barcode !== undefined && p.barcode !== null && p.barcode !== "") {
      const barcodeStr = String(p.barcode);
      barcodeMatch = barcodeStr.toLowerCase().includes(searchLower);
    }
    
    return nameMatch || categoryMatch || barcodeMatch;
  });

  filtered = filtered.sort((a, b) => {
    const aLow = a.qty <= a.minStock;
    const bLow = b.qty <= b.minStock;

    if (aLow && !bLow) return -1;
    if (!aLow && bLow) return 1;

    return a.name.localeCompare(b.name);
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-900 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading Inventory...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Cool Header Section */}
      <div className="relative bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 text-white overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 -left-4 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl animate-blob"></div>
          <div className="absolute top-0 -right-4 w-72 h-72 bg-yellow-500 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-2000"></div>
          <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-4000"></div>
        </div>
        
        <div className="relative px-6 py-8 md:py-12">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="bg-white/10 backdrop-blur-xl p-3 rounded-2xl">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-white via-gray-200 to-gray-300 bg-clip-text text-transparent">
                    Inventory Management
                  </h1>
                  <p className="text-gray-300 mt-1 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                    {activeBranch?.shopName || "Branch"} • Real-time stock tracking
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                {/* Dashboard Button */}
                <Link 
                  href="/owner-dashboard" 
                  className="group relative overflow-hidden bg-white/10 backdrop-blur-xl hover:bg-white/20 text-white px-5 py-2.5 rounded-xl transition-all duration-300 border border-white/20 flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:rotate-12 transition-transform" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM3 16a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" />
                  </svg>
                  <span className="font-medium">Dashboard</span>
                </Link>
                
                {/* Stats Badge */}
                <div className="bg-white/10 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">📦</span>
                    <div>
                      <p className="text-xs text-gray-300">Total Products</p>
                      <p className="text-lg font-bold">{products.length}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Curved bottom edge */}
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-t-3xl"></div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Offline warning with theme styling */}
        {offline && (
          <div className="mb-6 bg-yellow-50/90 backdrop-blur-xl border-l-4 border-yellow-400 p-4 rounded-xl shadow-lg">
            <p className="text-yellow-700 font-semibold flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              You are offline. Showing cached data.
            </p>
          </div>
        )}
        
        {/* SEARCH - Styled like your products page */}
        <div className="mb-8">
          <div className="relative group max-w-2xl">
            <input
              type="text"
              placeholder="Search products by name, category, or barcode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-14 pr-6 py-4 text-lg bg-white/90 backdrop-blur-xl border border-gray-200/60 hover:border-gray-300 focus:ring-4 focus:ring-gray-200/50 focus:border-gray-400 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 outline-none placeholder-gray-500 font-medium"
            />
            <div className="absolute left-5 top-1/2 -translate-y-1/2 text-2xl text-gray-400">
              🔍
            </div>
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* TABLE with theme styling */}
        <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-gray-900 to-gray-800 text-white">
                <tr>
                  <th className="p-4 text-left font-semibold">Barcode</th>
                  <th className="p-4 text-left font-semibold">Name</th>
                  <th className="p-4 text-left font-semibold">Category</th>
                  <th className="p-4 text-center font-semibold">Unit</th>
                  <th className="p-4 text-center font-semibold">Qty</th>
                  <th className="p-4 text-center font-semibold">Min</th>
                  <th className="p-4 text-center font-semibold">Purchase</th>
                  <th className="p-4 text-center font-semibold">Sale</th>
                  <th className="p-4 text-center font-semibold">Profit</th>
                  <th className="p-4 text-center font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, index) => {
                  const isLow = p.qty <= p.minStock;
                  const isCritical = p.qty <= p.minStock / 2;
                  
                  return (
                    <tr 
                      key={p.id} 
                      className={`border-t border-gray-200/60 hover:bg-gray-50/80 transition-all duration-300 ${
                        isCritical ? 'bg-red-50/50' : isLow ? 'bg-orange-50/30' : ''
                      }`}
                    >
                      <td className="p-4">
                        {p.barcode ? (
                          <span className="font-mono text-sm text-gray-600 flex items-center gap-1">
                            <span className="text-blue-500">📷</span>
                            {p.barcode}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-sm">—</span>
                        )}
                      </td>
                      <td className="p-4 font-medium text-gray-900">{p.name}</td>
                      <td className="p-4 text-gray-700">{p.category || "—"}</td>
                      <td className="p-4 text-center text-gray-700">{p.unit}</td>
                      <td className="p-4 text-center">
                        <span className={`font-bold ${
                          isCritical ? 'text-red-600' : isLow ? 'text-orange-600' : 'text-gray-900'
                        }`}>
                          {p.qty}
                        </span>
                       </td>
                      <td className="p-4 text-center text-gray-700">{p.minStock}</td>
                      <td className="p-4 text-center text-gray-700">₨{p.purchaseRate}</td>
                      <td className="p-4 text-center text-gray-700">₨{p.saleRate}</td>
                      <td className="p-4 text-center text-green-600 font-semibold">₨{p.profit}</td>
                      <td className="p-4 text-center">
                        {isLow ? (
                          <span className={`inline-block px-3 py-1 text-xs font-semibold rounded-full ${
                            isCritical 
                              ? 'bg-red-100 text-red-800' 
                              : 'bg-orange-100 text-orange-800'
                          }`}>
                            {isCritical ? '⚠ Critical' : '⚠ Low Stock'}
                          </span>
                        ) : p.allowSale ? (
                          <span className="inline-block px-3 py-1 text-xs font-semibold bg-green-100 text-green-800 rounded-full">
                            ✅ In Stock
                          </span>
                        ) : (
                          <span className="inline-block px-3 py-1 text-xs font-semibold bg-gray-100 text-gray-800 rounded-full">
                            ❌ Disabled
                          </span>
                        )}
                       </td>
                    </tr>
                  );
                })}

                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-center p-12">
                      <div className="text-4xl mb-3">📦</div>
                      <p className="text-lg text-gray-500 font-medium">No products found</p>
                      <p className="text-sm text-gray-400 mt-2">
                        Try adjusting your search or add a new product
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Global scrollbar styles and animations */}
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
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
        .overflow-x-auto::-webkit-scrollbar {
          height: 6px;
        }
        .overflow-x-auto::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 10px;
        }
        .overflow-x-auto::-webkit-scrollbar-thumb {
          background: #888;
          border-radius: 10px;
        }
        .overflow-x-auto::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
      `}</style>
    </div>
  );
}