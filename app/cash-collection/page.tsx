"use client";

import { useEffect, useState, useMemo } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  getDoc,
  doc,
  limit,
} from "firebase/firestore";
import { useBranch } from "@/context/BranchContext";
import Image from "next/image";
import Link from "next/link";

interface Sale {
  id: string;
  items: any[];
  createdBy: string;
  role: string;
  employeeId?: string | null;
  totalAmount: number;
  totalProfit?: number;
  date?: any;
  ownerId?: string;
  branchId?: string;
  saleDate?: Date;
}

interface Employee {
  id: string;
  name: string;
  role: string;
  uid?: string;
}

interface CashCollection {
  name: string;
  role: string;
  employeeId?: string;
  totalCash: number;
  saleCount: number;
  sales: Sale[];
}

interface CurrencyOption {
  symbol: string;
  code: string;
  name: string;
  flag: string;
}

export default function CashCollection() {
  const { activeBranch } = useBranch();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [todaySales, setTodaySales] = useState<Sale[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [debug, setDebug] = useState<string[]>([]);
  const [currency, setCurrency] = useState<CurrencyOption>({
    symbol: "$",
    code: "USD",
    name: "US Dollar",
    flag: "🇺🇸"
  });

  const currencies: CurrencyOption[] = [
    { symbol: "₨", code: "PKR", name: "Pakistani Rupee", flag: "🇵🇰" },
    { symbol: "$", code: "USD", name: "US Dollar", flag: "🇺🇸" },
    { symbol: "€", code: "EUR", name: "Euro", flag: "🇪🇺" },
    { symbol: "£", code: "GBP", name: "British Pound", flag: "🇬🇧" },
  ];

  // Helper functions for user-centric structure
  const getSalesCollection = (userId: string) => {
    return collection(db, "users", userId, "sales");
  };

  const getEmployeesCollection = (userId: string) => {
    return collection(db, "users", userId, "employees");
  };

  const addDebug = (msg: string) => {
    console.log(msg);
    setDebug(prev => [...prev.slice(-9), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  // Load owner info and currency
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setOwnerId(user.uid);
          addDebug(`👤 Owner logged in: ${data.username || data.name || 'Owner'}`);
          
          if (data.currency) {
            const savedCurrency = currencies.find(c => c.code === data.currency);
            if (savedCurrency) {
              setCurrency(savedCurrency);
            }
          }
        }
      } catch (error) {
        console.error("Error loading owner info:", error);
      }
      
      setIsLoading(false);
    });

    return () => unsub();
  }, []);

  // ✅ UPDATED: Load today's sales from user-centric subcollection
  useEffect(() => {
    if (!ownerId || !activeBranch?.id) return;

    addDebug(`📊 Loading sales for branch: ${activeBranch.shopName}`);

    const salesRef = getSalesCollection(ownerId);
    const q = query(
      salesRef,
      where("branchId", "==", activeBranch.id),
      orderBy("date", "desc"),
      limit(200)
    );

    const unsub = onSnapshot(q, (snap) => {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      
      addDebug(`📦 Received ${snap.docs.length} total sales from Firestore`);

      const sales: Sale[] = snap.docs
        .map((d) => {
          const data = d.data();
          let saleDate: Date;
          if (data.date?.toDate) {
            saleDate = data.date.toDate();
          } else if (typeof data.date === 'string') {
            saleDate = new Date(data.date);
          } else {
            saleDate = new Date(0);
          }
          
          return {
            id: d.id,
            items: data.items || [],
            createdBy: data.createdBy || 'Unknown',
            role: data.role || 'unknown',
            employeeId: data.employeeId || null,
            totalAmount: Number(data.totalAmount) || 0,
            totalProfit: data.totalProfit || 0,
            date: data.date,
            ownerId: data.ownerId,
            branchId: data.branchId,
            saleDate
          };
        })
        .filter(s => {
          const isValid = s.totalAmount > 0 && s.saleDate && !isNaN(s.saleDate.getTime()) && s.saleDate >= startOfDay;
          if (!isValid && s.totalAmount > 0) {
            addDebug(`⏰ Sale ${s.id.slice(-6)} is not from today (${s.saleDate?.toLocaleDateString()})`);
          }
          return isValid;
        })
        .sort((a, b) => b.saleDate!.getTime() - a.saleDate!.getTime());

      addDebug(`💰 Found ${sales.length} sales for today`);
      
      // Log sales by role
      const ownerSales = sales.filter(s => s.role === 'owner').length;
      const employeeSales = sales.filter(s => s.role === 'employee').length;
      addDebug(`👑 Owner sales: ${ownerSales} | 👥 Employee sales: ${employeeSales}`);

      setTodaySales(sales);
    });

    return () => unsub();
  }, [ownerId, activeBranch?.id]);

  // ✅ UPDATED: Load employees from user-centric subcollection
  useEffect(() => {
    if (!ownerId || !activeBranch?.id) return;

    addDebug(`👥 Loading employees for branch: ${activeBranch.shopName}`);

    const employeesRef = getEmployeesCollection(ownerId);
    const q = query(
      employeesRef,
      where("branchId", "==", activeBranch.id)
    );

    const unsub = onSnapshot(q, (snap) => {
      const empList: Employee[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || data.username || 'Unknown Employee',
          role: data.role || 'employee',
          uid: data.uid
        };
      });
      
      addDebug(`📋 Loaded ${empList.length} employees`);
      empList.forEach(emp => {
        addDebug(`   - ${emp.name} (UID: ${emp.uid || 'N/A'})`);
      });
      
      setEmployees(empList);
    });

    return () => unsub();
  }, [ownerId, activeBranch?.id]);

  // Cash collection calculation
  const cashCollections = useMemo(() => {
    const collections: CashCollection[] = [];

    addDebug("🔄 Calculating cash per person...");

    // 1. Owner sales
    const ownerSales = todaySales.filter(s => s.role === 'owner');
    const ownerTotal = ownerSales.reduce((sum, s) => sum + s.totalAmount, 0);
    collections.push({
      name: "Owner",
      role: "owner",
      totalCash: ownerTotal,
      saleCount: ownerSales.length,
      sales: ownerSales
    });
    addDebug(`👑 Owner: ${currency.symbol}${ownerTotal} from ${ownerSales.length} sales`);

    // 2. Employee sales grouped by name
    const employeeSales = todaySales.filter(s => s.role === 'employee');
    
    // Group by employee name
    const employeeGroups: { [key: string]: Sale[] } = {};
    
    employeeSales.forEach(sale => {
      const name = sale.createdBy || 'Unknown Employee';
      if (!employeeGroups[name]) {
        employeeGroups[name] = [];
      }
      employeeGroups[name].push(sale);
    });

    // Add each employee group
    Object.entries(employeeGroups).forEach(([name, sales]) => {
      const total = sales.reduce((sum, s) => sum + s.totalAmount, 0);
      collections.push({
        name: name,
        role: "employee",
        totalCash: total,
        saleCount: sales.length,
        sales: sales
      });
      addDebug(`👤 ${name}: ${currency.symbol}${total} from ${sales.length} sales`);
    });

    if (employeeSales.length > 0) {
      addDebug(`📊 Total employee sales: ${currency.symbol}${employeeSales.reduce((sum, s) => sum + s.totalAmount, 0)}`);
    }

    // Sort by total cash
    return collections.sort((a, b) => b.totalCash - a.totalCash);
  }, [todaySales, currency.symbol]);

  const totalShopCash = useMemo(() => {
    return cashCollections.reduce((sum, c) => sum + c.totalCash, 0);
  }, [cashCollections]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(Math.round(amount));
  };

  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

  if (isLoading || !ownerId || !activeBranch?.id) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-900 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading Cash Collection...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <header className="bg-gradient-to-b from-gray-900 via-gray-900/95 to-gray-900/90 text-white shadow-2xl backdrop-blur-2xl border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between py-4 sm:py-5 gap-3">
            <div className="flex items-center gap-3">
              <Link href="/owner-dashboard" className="relative group">
                <Image
                  src="/stockaro-logo.png"
                  alt="Stockaroo"
                  width={40}
                  height={40}
                  className="w-10 h-10 sm:w-11 sm:h-11 object-contain rounded-xl shadow-lg group-hover:scale-110 transition-all duration-300"
                  priority
                />
              </Link>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-200 bg-clip-text text-transparent">
                  💰 Cash Collection
                </h1>
                <p className="text-sm text-gray-300">
                  {activeBranch?.shopName || "Select Branch"} - Today
                </p>
              </div>
            </div>
            
            <Link 
              href="/owner-dashboard"
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/30 hover:border-white/50 text-white font-semibold text-sm shadow-xl transition-all duration-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span>Dashboard</span>
            </Link>

            <div className="flex items-center gap-2 bg-white/10 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/20">
              <span className="text-lg">{currency.flag}</span>
              <span className="font-bold">{currency.symbol}</span>
              <span className="text-xs text-gray-300">{currency.code}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Debug Panel */}
        <div className="bg-gray-900/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 p-4 mb-8 text-white">
          <details>
            <summary className="text-sm font-mono cursor-pointer opacity-70 hover:opacity-100 transition-opacity">
              🔍 Debug Info ({todaySales.length} sales, {employees.length} employees)
            </summary>
            <div className="mt-4 space-y-2">
              <div className="text-xs font-mono opacity-80">
                <p className="text-emerald-400">📊 Sales by role:</p>
                <p className="ml-4">Owner: {todaySales.filter(s => s.role === 'owner').length}</p>
                <p className="ml-4">Employee: {todaySales.filter(s => s.role === 'employee').length}</p>
              </div>
              <div className="text-xs font-mono opacity-80 max-h-40 overflow-y-auto">
                {debug.map((msg, i) => (
                  <div key={i} className="border-t border-white/10 py-1 first:border-0">{msg}</div>
                ))}
              </div>
            </div>
          </details>
        </div>

        {/* Total Cash Card */}
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-2xl shadow-2xl p-8 mb-8 text-center">
          <div className="text-4xl mb-2">💵</div>
          <h2 className="text-3xl font-bold mb-2">Total Cash Today</h2>
          <div className="text-5xl font-black mb-4">
            {currency.symbol}{formatCurrency(totalShopCash)}
          </div>
          <p className="text-emerald-100 text-lg">
            {todaySales.length} sales • {cashCollections.filter(c => c.totalCash > 0).length} contributors
          </p>
          <div className="mt-4 text-sm bg-white/20 backdrop-blur-xl px-4 py-2 rounded-xl">
            Live • {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}
          </div>
        </div>

        {/* Cash Collection Table */}
        <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/60 p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Cash by Person</h2>
            <div className="text-sm text-gray-500">
              Updated live • {todaySales.length} sales today
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full table-auto">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-4 px-6 font-semibold text-gray-900">Person</th>
                  <th className="text-right py-4 px-6 font-semibold text-gray-900">Cash Collected</th>
                  <th className="text-right py-4 px-6 font-semibold text-gray-900">Sales</th>
                  <th className="text-right py-4 px-6 font-semibold text-gray-900">Avg Sale</th>
                </tr>
              </thead>
              <tbody>
                {cashCollections.map((collection, index) => (
                  <tr key={collection.name} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-lg ${
                          collection.role === 'owner' 
                            ? 'bg-gradient-to-br from-purple-500 to-purple-600 text-white' 
                            : 'bg-gradient-to-br from-blue-500 to-blue-600 text-white'
                        }`}>
                          {collection.role === 'owner' ? '👑' : getInitials(collection.name)}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">{collection.name}</div>
                          <div className="text-sm text-gray-500 capitalize">{collection.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className={`font-black text-2xl ${
                        collection.totalCash === 0 
                          ? 'text-gray-400' 
                          : 'bg-gradient-to-r from-emerald-500 to-emerald-600 bg-clip-text text-transparent'
                      }`}>
                        {currency.symbol}{formatCurrency(collection.totalCash)}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                        collection.saleCount === 0 
                          ? 'bg-gray-100 text-gray-500' 
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {collection.saleCount}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className={`font-semibold text-lg ${
                        collection.saleCount > 0 
                          ? 'text-emerald-600' 
                          : 'text-gray-400'
                      }`}>
                        {collection.saleCount > 0 
                          ? `${currency.symbol}${formatCurrency(collection.totalCash / collection.saleCount)}` 
                          : '-'
                        }
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Sales */}
        {todaySales.length > 0 && (
          <div className="mt-8 bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/60 p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              Recent Sales 
              <span className="text-sm bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-semibold">
                {todaySales.length}
              </span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {todaySales.slice(0, 9).map((sale) => (
                <div key={sale.id} className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border border-gray-200 p-5 hover:shadow-lg transition-all hover:-translate-y-1">
                  <div className="flex justify-between items-start mb-3">
                    <span className="font-mono font-semibold text-sm bg-gray-200 px-2 py-1 rounded text-gray-700">
                      #{sale.id.slice(-8)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {sale.saleDate?.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </span>
                  </div>
                  <div className="mb-3">
                    <div className="font-semibold text-gray-900 text-sm truncate">{sale.createdBy}</div>
                    <div className="text-xs text-gray-500 capitalize">{sale.role}</div>
                  </div>
                  <div className="text-2xl font-black bg-gradient-to-r from-emerald-500 to-emerald-600 bg-clip-text text-transparent mb-2">
                    {currency.symbol}{formatCurrency(sale.totalAmount)}
                  </div>
                  {sale.items && sale.items.length > 0 && (
                    <div className="text-xs text-gray-500 space-y-1 max-h-16 overflow-hidden">
                      {sale.items.slice(0, 3).map((item: any, idx: number) => (
                        <div key={idx} className="truncate" title={`${item.name} × ${item.qty}`}>
                          {item.name} × {item.qty}
                        </div>
                      ))}
                      {sale.items.length > 3 && (
                        <div className="text-gray-400">+{sale.items.length - 3} more</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {todaySales.length === 0 && !isLoading && (
          <div className="text-center py-20">
            <div className="text-6xl mb-6">💸</div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">No sales today yet</h3>
            <p className="text-gray-500 text-lg mb-6 max-w-md mx-auto">
              Cash collection will appear here automatically when sales are completed
            </p>
            <div className="bg-gradient-to-br from-gray-100 to-gray-200 text-gray-900 px-8 py-4 rounded-2xl font-bold text-xl inline-block shadow-xl border-4 border-dashed border-gray-300">
              Total: {currency.symbol}0
            </div>
          </div>
        )}
      </main>
    </div>
  );
}