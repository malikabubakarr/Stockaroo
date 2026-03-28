"use client";

import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useBranch } from "@/context/BranchContext";
import Link from "next/link";

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
  barcode?: string | number; // Added barcode field
}

export default function InventoryPage() {
  const { activeBranch } = useBranch();

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);

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

  // Load products in real-time
  useEffect(() => {
    if (!activeBranch?.id) return;

    const q = query(
      collection(db, "products"),
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
          barcode: data.barcode ? String(data.barcode) : "", // Convert to string
        };
      }) as Product[];

      setProducts(list);
    });

    return () => unsub();
  }, [activeBranch]);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      
      {/* Header with gradient */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-transparent">
          {activeBranch?.shopName || "Branch"} Inventory
        </h1>
        <p className="text-gray-600 mt-1">Manage and monitor your stock levels</p>
      </div>

      {/* Offline warning with theme styling */}
      {offline && (
        <div className="mb-6 bg-yellow-50/90 backdrop-blur-xl border-l-4 border-yellow-400 p-4 rounded-xl shadow-lg">
          <p className="text-yellow-700 font-semibold flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            You are offline. Showing cached data.
          </p>
        </div>
      )}
      
      {/* Dashboard Button */}
      <div className="mb-4 text-right">
        <Link 
          href="/owner-dashboard" 
          className="inline-flex items-center px-4 py-2 bg-black/5 hover:bg-black/20 text-black rounded-lg transition-all duration-300 border border-white/20 backdrop-blur-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2zM3 16a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z" />
          </svg>
          Dashboard
        </Link>
      </div>

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

      {/* Global scrollbar styles */}
      <style jsx global>{`
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