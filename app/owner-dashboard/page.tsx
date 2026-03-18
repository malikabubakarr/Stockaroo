"use client";

import { useBranch } from "@/context/BranchContext";
import { useEffect, useState, useCallback, useMemo, memo } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, onSnapshot, query, where, orderBy, writeBatch, limit } from "firebase/firestore";
import Link from "next/link";
import Image from "next/image";

// Debug mode - set to false in production
const DEBUG = false;

interface Branch {
  id: string;
  shopName: string;
  ownerId: string;
  isMain?: boolean;
  currency: string;
  currencySymbol?: string;
}

interface Stats {
  todayProfit: number;
  todaySales: number;
  weekProfit: number;
  weekSales: number;
  monthProfit: number;
  monthSales: number;
  yearProfit: number;
  yearSales: number;
}

interface CurrencyOption {
  symbol: string;
  code: string;
  name: string;
  flag: string;
}

// Memoized StatsCard to prevent re-renders
const StatsCard = memo(({ 
  title, 
  sales, 
  profit, 
  period, 
  icon,
  isLoading,
  currencySymbol
}: {
  title: string;
  sales: number;
  profit: number;
  period: string;
  icon: string;
  isLoading: boolean;
  currencySymbol: string;
}) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PK', {
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="group relative bg-gradient-to-b from-gray-900/95 to-gray-800/90 backdrop-blur-xl p-3 sm:p-4 rounded-xl sm:rounded-2xl border border-white/10 shadow-2xl hover:shadow-3xl hover:-translate-y-0.5 sm:hover:-translate-y-1 transition-all duration-300 overflow-hidden h-full flex flex-col justify-between">
      {/* Subtle shine effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-white/10 via-transparent to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 -skew-x-12 -translate-x-32 group-hover:translate-x-32 pointer-events-none"></div>
      
      <div className="relative z-10 flex items-center justify-between mb-1.5 sm:mb-2 md:mb-3">
        <div className="text-gray-300 text-[10px] sm:text-xs font-medium uppercase tracking-wider">{title}</div>
        <div className="text-gray-400 text-sm sm:text-base md:text-lg opacity-90">{icon}</div>
      </div>
      
      <div className="space-y-1 sm:space-y-2 flex-1 flex flex-col justify-end">
        <div className="text-lg sm:text-xl md:text-2xl font-bold bg-gradient-to-r from-white to-gray-200 bg-clip-text text-transparent drop-shadow-sm truncate">
          {currencySymbol}{isLoading ? '...' : formatCurrency(sales)}
        </div>
        <div className="text-xs sm:text-sm font-semibold text-white/90 flex items-center gap-0.5 sm:gap-1 flex-wrap">
          <span className="truncate">{currencySymbol}{isLoading ? '...' : formatCurrency(profit)}</span> 
          <span className="text-[10px] sm:text-xs text-gray-300">Profit</span>
        </div>
        <div className="text-[10px] sm:text-xs text-gray-400 font-medium">{period}</div>
      </div>
    </div>
  );
});

StatsCard.displayName = 'StatsCard';

export default function OwnerDashboard() {
  const [ownerName, setOwnerName] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const { activeBranch, setActiveBranch } = useBranch();
  const [isOffline, setIsOffline] = useState(false);
  const [stats, setStats] = useState<Stats>({
    todayProfit: 0,
    todaySales: 0,
    weekProfit: 0,
    weekSales: 0,
    monthProfit: 0,
    monthSales: 0,
    yearProfit: 0,
    yearSales: 0,
  });
  const [loadingStats, setLoadingStats] = useState(true);
  const [showCurrencyMenu, setShowCurrencyMenu] = useState(false);
  const [currency, setCurrency] = useState<CurrencyOption>({
    symbol: "$",
    code: "USD",
    name: "US Dollar",
    flag: "🇺🇸"
  });
  const [updatingCurrency, setUpdatingCurrency] = useState(false);

  // Currency list
  const currencies: CurrencyOption[] = [
    { symbol: "₨", code: "PKR", name: "Pakistani Rupee", flag: "🇵🇰" },
    { symbol: "$", code: "USD", name: "US Dollar", flag: "🇺🇸" },
    { symbol: "€", code: "EUR", name: "Euro", flag: "🇪🇺" },
    { symbol: "£", code: "GBP", name: "British Pound", flag: "🇬🇧" },
    { symbol: "¥", code: "JPY", name: "Japanese Yen", flag: "🇯🇵" },
    { symbol: "₩", code: "KRW", name: "South Korean Won", flag: "🇰🇷" },
    { symbol: "₱", code: "PHP", name: "Philippine Peso", flag: "🇵🇭" },
    { symbol: "₦", code: "NGN", name: "Nigerian Naira", flag: "🇳🇬" },
    { symbol: "₪", code: "ILS", name: "Israeli Shekel", flag: "🇮🇱" },
    { symbol: "₫", code: "VND", name: "Vietnamese Dong", flag: "🇻🇳" },
  ];

  /* ---------------- ONLINE / OFFLINE DETECTION ---------------- */
  useEffect(() => {
    const updateStatus = () => {
      setIsOffline(!navigator.onLine);
    };

    updateStatus();
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  /* ---------------- AUTH + DATA LOAD WITH CACHE ---------------- */
  useEffect(() => {
    // Load branches from cache instantly
    const cachedBranches = localStorage.getItem("branches_cache");
    if (cachedBranches) {
      try {
        const parsed = JSON.parse(cachedBranches);
        setBranches(parsed);
        
        // Also try to load active branch from cache
        const storedBranch = localStorage.getItem("activeBranch");
        if (storedBranch) {
          const parsedBranch = JSON.parse(storedBranch);
          const found = parsed.find((b: Branch) => b.id === parsedBranch.id);
          if (found) setActiveBranch(found);
        } else if (parsed.length > 0 && !activeBranch) {
          setActiveBranch(parsed[0]);
        }
      } catch (e) {
        if (DEBUG) console.error("Error parsing branches cache:", e);
      }
    }

    // Load stats from cache
    const cachedStats = localStorage.getItem("stats_cache");
    if (cachedStats) {
      try {
        setStats(JSON.parse(cachedStats));
        setLoadingStats(false);
      } catch (e) {
        if (DEBUG) console.error("Error parsing stats cache:", e);
      }
    }

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setCurrentUser(null);
        return;
      }

      setCurrentUser(user);
      const ownerId = user.uid;

      try {
        const userDocRef = doc(db, "users", ownerId);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
          const userData = userSnap.data();
          setOwnerName(userData.name || "Owner");
          
          // Load user's saved currency preference
          if (userData.currency) {
            const savedCurrency = currencies.find(c => c.code === userData.currency);
            if (savedCurrency) {
              setCurrency(savedCurrency);
            }
          }
        }

        const branchesQuery = query(
          collection(db, "branches"),
          where("ownerId", "==", ownerId)
        );

        const unsubscribeBranches = onSnapshot(branchesQuery, (snap) => {
          const branchList = snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              shopName: data.shopName,
              ownerId: data.ownerId,
              isMain: data.isMain,
              currency: typeof data.currency === "string" ? data.currency : currency.code,
              currencySymbol: typeof data.currencySymbol === "string" ? data.currencySymbol : currency.symbol,
            } as Branch;
          });
        
          setBranches(branchList);
          
          // Save to cache
          localStorage.setItem("branches_cache", JSON.stringify(branchList));
        
          const storedBranch = localStorage.getItem("activeBranch");
        
          if (storedBranch) {
            const parsed = JSON.parse(storedBranch);
            const found = branchList.find((b) => b.id === parsed.id);
            if (found) setActiveBranch({
              ...found,
              currencySymbol: typeof found.currencySymbol === "string" ? found.currencySymbol : currency.symbol
            });
          } else if (branchList.length > 0 && !activeBranch) {
            setActiveBranch({
              ...branchList[0],
              currencySymbol: typeof branchList[0].currencySymbol === "string" ? branchList[0].currencySymbol : currency.symbol
            });
          }
        });

        return () => unsubscribeBranches();
      } catch (error) {
        if (DEBUG) console.error("Error in auth setup:", error);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  /* ---------------- UPDATE USER CURRENCY PREFERENCE WITH BATCH ---------------- */
  const updateUserCurrency = useCallback(async (selectedCurrency: CurrencyOption) => {
    if (!currentUser?.uid) return;
    
    setUpdatingCurrency(true);
    try {
      const userDocRef = doc(db, "users", currentUser.uid);
      
      // Use batch write for all updates
      const batch = writeBatch(db);
      
      // Update user preference
      batch.update(userDocRef, {
        currency: selectedCurrency.code,
        currencySymbol: selectedCurrency.symbol,
        updatedAt: new Date()
      });
      
      // Update all branches at once with batch
      branches.forEach((branch) => {
        const branchRef = doc(db, "branches", branch.id);
        batch.update(branchRef, {
          currency: selectedCurrency.code,
          currencySymbol: selectedCurrency.symbol
        });
      });
      
      // Commit all updates at once
      await batch.commit();
      
      // Update local state
      setCurrency(selectedCurrency);
      
      if (DEBUG) console.log("Currency updated successfully for all branches");
      
    } catch (error) {
      if (DEBUG) console.error("Error updating currency:", error);
    } finally {
      setUpdatingCurrency(false);
      setShowCurrencyMenu(false);
    }
  }, [currentUser?.uid, branches]);

  /* ---------------- STATS LOAD WITH LIMIT AND CACHE ---------------- */
  useEffect(() => {
    if (!activeBranch?.id || !currentUser?.uid) {
      setLoadingStats(false);
      return;
    }

    const ownerId = currentUser.uid;
    const branchId = activeBranch.id;

    // 🔥 CRITICAL FIX: Add limit to sales query
    const salesQuery = query(
      collection(db, "sales"),
      where("ownerId", "==", ownerId),
      where("branchId", "==", branchId),
      orderBy("date", "desc"),
      limit(200) // Only load recent 200 sales for performance
    );

    const unsubscribe = onSnapshot(salesQuery, (snap) => {
      let todaySales = 0, todayProfit = 0;
      let weekSales = 0, weekProfit = 0;
      let monthSales = 0, monthProfit = 0;
      let yearSales = 0, yearProfit = 0;

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const yearStart = new Date(now.getFullYear(), 0, 1);

      snap.docs.forEach((doc) => {
        const data = doc.data();
        const saleDate = data.date?.toDate();
        
        if (saleDate) {
          if (saleDate >= todayStart) {
            todaySales += data.totalAmount || 0;
            todayProfit += data.totalProfit || 0;
          }
          if (saleDate >= weekStart) {
            weekSales += data.totalAmount || 0;
            weekProfit += data.totalProfit || 0;
          }
          if (saleDate >= monthStart) {
            monthSales += data.totalAmount || 0;
            monthProfit += data.totalProfit || 0;
          }
          if (saleDate >= yearStart) {
            yearSales += data.totalAmount || 0;
            yearProfit += data.totalProfit || 0;
          }
        }
      });

      const statsData = {
        todayProfit, todaySales,
        weekProfit, weekSales,
        monthProfit, monthSales,
        yearProfit, yearSales,
      };

      setStats(statsData);
      
      // ✅ Save stats to cache for offline/instant load
      localStorage.setItem("stats_cache", JSON.stringify(statsData));
      
      setLoadingStats(false);
    });

    return () => unsubscribe();
  }, [activeBranch?.id, currentUser?.uid]);

  /* ---------------- SAVE ACTIVE BRANCH TO LOCAL STORAGE ---------------- */
  useEffect(() => {
    if (activeBranch) {
      localStorage.setItem("activeBranch", JSON.stringify(activeBranch));
    }
  }, [activeBranch]);

  /* ---------------- LOAD SAVED CURRENCY FROM LOCAL STORAGE (FALLBACK) ---------------- */
  useEffect(() => {
    const savedCurrency = localStorage.getItem("currency");
    if (savedCurrency && !currentUser) {
      try {
        setCurrency(JSON.parse(savedCurrency));
      } catch (e) {
        // ignore
      }
    }
  }, [currentUser]);

  /* ---------------- SAVE CURRENCY TO LOCAL STORAGE (FALLBACK) ---------------- */
  useEffect(() => {
    localStorage.setItem("currency", JSON.stringify(currency));
  }, [currency]);

  /* ---------------- HELPER ---------------- */
  const getInitials = useCallback((name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2), []);

  // Memoized branch list to prevent unnecessary re-renders
  const branchElements = useMemo(() => {
    return branches.map((branch) => {
      const branchWithCurrency = {
        ...branch,
        currencySymbol: branch.currencySymbol || currency.symbol,
        currency: branch.currency || currency.code
      };
      
      return (
        <button
          key={branch.id}
          onClick={() => {
            setActiveBranch(branchWithCurrency);
            localStorage.setItem("activeBranch", JSON.stringify(branchWithCurrency));
          }}
          className={`group relative px-3 sm:px-4 md:px-5 py-2 sm:py-2.5 md:py-3.5 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold border-2 shadow-xl transition-all duration-400 flex items-center gap-1 sm:gap-2 backdrop-blur-xl flex-shrink-0 whitespace-nowrap hover:scale-[1.02] active:scale-[0.98] h-10 sm:h-12 md:h-14 min-w-[120px] sm:min-w-[140px] md:min-w-[160px] max-w-[180px] sm:max-w-[200px] md:max-w-[220px] ${
            activeBranch?.id === branch.id
              ? "bg-gradient-to-r from-white/20 to-white/10 text-white border-white/40 shadow-white/20 shadow-2xl ring-2 sm:ring-4 ring-white/30 backdrop-blur-2xl"
              : "bg-white/10 hover:bg-white/20 text-white/95 border-white/30 hover:border-white/50 hover:shadow-2xl hover:shadow-white/20 backdrop-blur-xl"
          }`}
        >
          <span className="truncate block font-semibold text-xs sm:text-sm">
            {branch.shopName.length > 12 ? `${branch.shopName.slice(0, 12)}...` : branch.shopName}
          </span>
          {branch.isMain && (
            <span className="text-[10px] sm:text-xs bg-white/20 backdrop-blur-sm text-white px-1.5 sm:px-2 py-0.5 rounded-full font-bold shadow-md ml-auto flex-shrink-0">
              ⭐
            </span>
          )}
          {branch.currency && branch.currency !== currency.code && (
            <span className="text-[10px] sm:text-xs bg-white/10 backdrop-blur-sm text-white/80 px-1 py-0.5 rounded-full ml-0.5 sm:ml-1 flex-shrink-0">
              {branch.currencySymbol || branch.currency}
            </span>
          )}
        </button>
      );
    });
  }, [branches, activeBranch?.id, currency.code, currency.symbol, setActiveBranch]);

  // Memoized stats cards
  const statsCards = useMemo(() => {
    if (activeBranch && !loadingStats) {
      return (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 md:gap-4 lg:gap-5 w-full">
          <StatsCard
            title="Today"
            sales={stats.todaySales}
            profit={stats.todayProfit}
            period="Live"
            icon="📈"
            isLoading={false}
            currencySymbol={currency.symbol}
          />
          <StatsCard
            title="Week"
            sales={stats.weekSales}
            profit={stats.weekProfit}
            period="7 Days"
            icon="📊"
            isLoading={false}
            currencySymbol={currency.symbol}
          />
          <StatsCard
            title="Month"
            sales={stats.monthSales}
            profit={stats.monthProfit}
            period="30 Days"
            icon="📅"
            isLoading={false}
            currencySymbol={currency.symbol}
          />
          <StatsCard
            title="Year"
            sales={stats.yearSales}
            profit={stats.yearProfit}
            period="YTD"
            icon="🎯"
            isLoading={false}
            currencySymbol={currency.symbol}
          />
        </div>
      );
    }
    
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 md:gap-4 lg:gap-5 w-full">
        {Array(4).fill(0).map((_, i) => (
          <div key={i} className="group relative bg-gradient-to-b from-gray-900/80 to-gray-800/70 backdrop-blur-xl p-3 sm:p-4 rounded-xl border border-white/10 shadow-2xl animate-pulse h-full flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2 sm:mb-3 md:mb-4">
              <div className="h-2 sm:h-2.5 md:h-3 bg-white/30 rounded-full w-8 sm:w-10 md:w-14"></div>
              <div className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 bg-white/20 rounded-lg sm:rounded-xl"></div>
            </div>
            <div className="space-y-1 sm:space-y-2 md:space-y-3">
              <div className="h-4 sm:h-5 md:h-7 bg-white/20 rounded-lg sm:rounded-xl w-16 sm:w-20 md:w-24"></div>
              <div className="h-2 sm:h-3 md:h-4 bg-white/20 rounded-full w-12 sm:w-16 md:w-20"></div>
              <div className="h-1.5 sm:h-2 md:h-3 bg-white/15 rounded w-10 sm:w-12 md:w-16"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }, [activeBranch, loadingStats, stats, currency.symbol]);

  // Memoized menu cards
  const menuCards = useMemo(() => {
    const cards = [
      { href: "/products", icon: "📦", title: "Products", subtitle: "Manage inventory" },
      { href: "/owner/inventory", icon: "📊", title: "Inventory", subtitle: "Stock overview" },
      { href: "/employees", icon: "👥", title: "Employees", subtitle: "Team management" },
      { href: "/sales", icon: "💰", title: "Sales", subtitle: "Revenue tracking" },
      { href: "/branches", icon: "🏢", title: "Branches", subtitle: "Multi-location" },
      { href: "/cash-collection", icon: "💵", title: "Cash Collection", subtitle: "Employee cash" },
    ];

    return cards.map(({ href, icon, title, subtitle }) => (
      <Link 
        key={href} 
        href={href}
        className="group relative bg-white/90 hover:bg-white backdrop-blur-xl p-4 sm:p-5 md:p-6 rounded-xl sm:rounded-2xl border border-gray-200/60 hover:border-gray-300 shadow-lg hover:shadow-2xl hover:shadow-gray-200/50 hover:-translate-y-1 sm:hover:-translate-y-2 active:translate-y-0 transition-all duration-400 overflow-hidden text-center h-full min-h-[100px] sm:min-h-[110px] md:min-h-[130px] flex flex-col justify-center items-stretch"
      >
        {/* Shine effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-white/20 via-transparent to-white/10 opacity-0 group-hover:opacity-100 transition-all duration-700 -skew-x-12 -translate-x-full group-hover:translate-x-full pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col items-center gap-2 sm:gap-2.5 md:gap-3 h-full justify-center pb-1 sm:pb-2">
          <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-2xl group-hover:scale-110 transition-all duration-400 backdrop-blur-sm border border-white/20 hover:border-white/40">
            <span className="text-2xl sm:text-3xl md:text-4xl">{icon}</span>
          </div>
          <div className="space-y-0.5 sm:space-y-1 px-1 sm:px-2">
            <p className="font-bold text-sm sm:text-base md:text-lg text-gray-900 leading-tight line-clamp-2 group-hover:text-gray-950">
              {title}
            </p>
            <p className="text-xs sm:text-sm text-gray-600 font-semibold tracking-wide line-clamp-2">
              {subtitle}
            </p>
          </div>
        </div>
      </Link>
    ));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 text-gray-900">
      
      {/* HEADER - Stylish Black */}
      <header className="bg-gradient-to-b from-gray-900 via-gray-900/95 to-gray-900/90 text-white shadow-2xl backdrop-blur-2xl border-b border-white/10 z-50">
        <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 max-w-7xl mx-auto">
          
          {/* Top Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between py-3 sm:py-4 gap-3 min-h-[60px] sm:min-h-[72px]">
            
            {/* Logo & Owner Name */}
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0 w-full sm:w-auto">
              <div className="relative group flex-shrink-0">
                <Image
                  src="/stockaro-logo.png"
                  alt="Stockaroo"
                  width={40}
                  height={40}
                  className="w-8 h-8 sm:w-10 sm:h-10 object-contain rounded-xl shadow-lg group-hover:scale-110 transition-all duration-300"
                  priority
                />
                <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent rounded-xl blur opacity-0 group-hover:opacity-100 transition-all duration-300"></div>
              </div>
              <div className="min-w-0 flex-1 sm:flex-none">
                <h1 className="text-base sm:text-xl md:text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-200 bg-clip-text text-transparent truncate">
                  Stockaroo
                </h1>
              </div>
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 w-full sm:w-auto justify-between sm:justify-end flex-wrap sm:flex-nowrap">
              
              {/* Profile Avatar */}
              <div className="flex-shrink-0 group">
                {currentUser?.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt="Profile"
                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl border-2 border-white/30 shadow-xl ring-2 ring-white/20 hover:ring-white/50 transition-all duration-300 cursor-pointer group-hover:scale-105"
                  />
                ) : (
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-white/10 backdrop-blur-sm border-2 border-white/30 shadow-xl flex items-center justify-center font-bold text-xs sm:text-sm text-white ring-2 ring-white/20 group-hover:scale-105 transition-all duration-300 cursor-pointer">
                    {getInitials(ownerName)}
                  </div>
                )}
                <div className="hidden sm:block text-xs sm:text-sm font-semibold text-white/90 mt-0.5 truncate max-w-[100px] md:max-w-[150px]">
                  {ownerName || "Owner"}
                </div>
              </div>
              
              {/* Currency Selector */}
              <div className="relative flex-shrink-0 z-50">
                <button
                  onClick={() => setShowCurrencyMenu(!showCurrencyMenu)}
                  disabled={updatingCurrency}
                  className="group flex items-center gap-1 sm:gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-xl px-2 sm:px-3 md:px-4 py-1.5 sm:py-2 rounded-xl border border-white/30 hover:border-white/50 text-white font-semibold text-xs sm:text-sm shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] h-8 sm:h-10 md:h-12 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="text-base sm:text-lg">{currency.flag}</span>
                  <span className="font-bold text-sm sm:text-base">{currency.symbol}</span>
                  <svg className={`w-3 h-3 sm:w-4 sm:h-4 transition-transform duration-300 ${showCurrencyMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {/* Currency Dropdown - Responsive */}
                {showCurrencyMenu && (
                  <div className="absolute top-full right-0 mt-1 sm:mt-2 w-64 sm:w-72 md:w-80 max-w-[calc(100vw-2rem)] bg-white/95 backdrop-blur-2xl border border-gray-200/50 rounded-xl sm:rounded-2xl shadow-2xl z-50 animate-in slide-in-from-top-2 duration-300 max-h-[50vh] sm:max-h-[60vh] overflow-y-auto">
                    <div className="py-2 sm:py-3">
                      <div className="px-3 sm:px-4 md:px-5 py-2 sm:py-3 md:py-4 border-b border-gray-200/50 bg-white/80 backdrop-blur-sm">
                        <h3 className="text-xs sm:text-sm md:text-base font-bold text-gray-900 uppercase tracking-wider flex items-center gap-1 sm:gap-2">
                          <span className="text-sm sm:text-base">🌍</span> 
                          <span className="truncate">Select Currency</span>
                        </h3>
                      </div>
                      <div className="max-h-[40vh] sm:max-h-[45vh] md:max-h-[50vh] overflow-y-auto">
                        {currencies.map((cur) => (
                          <button
                            key={cur.code}
                            onClick={() => updateUserCurrency(cur)}
                            disabled={updatingCurrency}
                            className="w-full flex items-center gap-2 sm:gap-3 px-3 sm:px-4 md:px-5 py-2 sm:py-3 md:py-4 hover:bg-gray-50/80 transition-all duration-300 text-left text-xs sm:text-sm font-semibold border-b border-gray-100/50 last:border-b-0 hover:border-gray-200 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-400/50 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <span className="text-lg sm:text-xl md:text-2xl flex-shrink-0">{cur.flag}</span>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-gray-900 truncate text-xs sm:text-sm md:text-base">{cur.name}</div>
                              <div className="text-[10px] sm:text-xs text-gray-500 font-mono bg-gray-100 px-1.5 sm:px-2 py-0.5 rounded-full inline-block mt-0.5">
                                {cur.code}
                              </div>
                            </div>
                            <span className="text-base sm:text-lg md:text-xl font-black text-gray-900 flex-shrink-0 bg-white px-1.5 sm:px-2 md:px-3 py-1 sm:py-1.5 rounded-lg shadow-md">
                              {cur.symbol}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Offline Badge */}
              {isOffline && (
                <div className="bg-white/10 backdrop-blur-xl border border-white/30 text-white/90 text-xs sm:text-sm px-2 sm:px-3 md:px-4 py-1.5 sm:py-2 rounded-xl font-semibold shadow-xl ring-1 ring-white/20 h-8 sm:h-10 md:h-12 flex items-center justify-center flex-shrink-0 animate-pulse">
                  <span className="block sm:hidden">📴</span>
                  <span className="hidden sm:block">📴 Offline</span>
                </div>
              )}
            </div>
          </div>

          {/* Branch Selector */}
          {branches.length > 0 && (
            <div className="px-0 pb-4 sm:pb-6 md:pb-8 w-full overflow-x-auto -mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 px-3 sm:px-4 md:px-6 lg:px-8 scrollbar-thin">
              <div className="flex gap-2 sm:gap-3 py-2 sm:py-3 md:py-4 min-w-min">
                {branchElements}
              </div>
            </div>
          )}
          
          {/* Stats Cards */}
          <div className="pb-4 sm:pb-6 md:pb-8 lg:pb-10">
            {statsCards}
          </div>
        </div>
      </header>
      
      {/* MAIN CONTENT */}
      <main className="w-full flex-grow">
        <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 max-w-7xl mx-auto pb-12 sm:pb-16 pt-4 sm:pt-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 md:gap-5">
            {menuCards}
          </div>
        </div>
      </main>

      {/* FOOTER - Compact Stylish Black */}
      <footer className="bg-gradient-to-t from-gray-900/95 via-gray-900/90 to-gray-900/80 text-white/95 border-t border-white/10 backdrop-blur-2xl shadow-2xl">
        <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 max-w-7xl mx-auto py-6 sm:py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-6">

            {/* Logo & Branding */}
            <div className="flex items-center gap-3 sm:gap-4 text-center sm:text-left">
              <div className="relative flex-shrink-0">
                <Image
                  src="/stockaro-logo.png"
                  alt="Stockaroo"
                  width={40}
                  height={40}
                  className="object-contain shadow-2xl rounded-xl sm:rounded-2xl w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 transition-all duration-400 group-hover:scale-110"
                  priority
                />
              </div>
              <div>
                <h3 className="text-xl sm:text-2xl md:text-3xl font-black bg-gradient-to-r from-white via-gray-100 to-gray-200 bg-clip-text text-transparent leading-tight">
                  Stockaroo
                </h3>
                <p className="text-xs sm:text-sm md:text-base text-gray-400/80 font-semibold mt-0.5 sm:mt-1">
                  © {new Date().getFullYear()} All rights reserved
                </p>
              </div>
            </div>

            {/* Active Branch & Currency */}
            <div className="flex items-center gap-2 sm:gap-3 md:gap-4 bg-white/5 backdrop-blur-xl border border-white/20 rounded-xl sm:rounded-2xl px-4 sm:px-5 md:px-6 py-3 sm:py-4 shadow-xl w-full sm:w-auto justify-center sm:justify-start">
              
              {/* Currency */}
              <div className="flex items-center gap-1 sm:gap-2 p-1.5 sm:p-2 bg-white/10 rounded-lg sm:rounded-xl border border-white/20 min-w-[50px] sm:min-w-[60px] md:min-w-[70px] justify-center">
                <span className="text-xl sm:text-2xl md:text-3xl">{currency.flag}</span>
                <span className="text-lg sm:text-xl md:text-2xl font-black bg-gradient-to-r from-white to-gray-200 bg-clip-text text-transparent">
                  {currency.symbol}
                </span>
              </div>

              {/* Branch Name */}
              <div className="flex flex-col items-center sm:items-start min-w-0">
                <span className="text-[10px] sm:text-xs uppercase tracking-wider text-gray-400 font-semibold bg-white/10 px-1.5 sm:px-2 py-0.5 rounded-full border border-white/20">
                  Active Branch
                </span>
                <span className="text-sm sm:text-base md:text-lg font-black text-white truncate max-w-[150px] sm:max-w-[180px] md:max-w-[200px] bg-gradient-to-r from-gray-100 to-gray-200 bg-clip-text">
                  {activeBranch?.shopName || "Select a Branch"}
                </span>
              </div>

              {/* Status Indicator */}
              {!isOffline ? (
                <div className="flex items-center gap-1 sm:gap-2 p-1.5 sm:p-2 bg-white/10 rounded-lg sm:rounded-xl border border-white/20">
                  <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 md:w-3 md:h-3 bg-emerald-400 rounded-full shadow-lg"></div>
                  <span className="text-xs sm:text-sm font-bold text-white/90 hidden sm:inline">Online</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 sm:gap-2 p-1.5 sm:p-2 bg-white/5 rounded-lg sm:rounded-xl border border-white/20 animate-pulse">
                  <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 md:w-3 md:h-3 bg-gray-400 rounded-full shadow-lg"></div>
                  <span className="text-xs sm:text-sm font-bold text-white/70 hidden sm:inline">Offline</span>
                </div>
              )}

            </div>
          </div>
        </div>
      </footer>

      {/* Global Styles */}
      <style jsx global>{`
        /* Custom Scrollbar */
        .scrollbar-thin::-webkit-scrollbar {
          height: 4px;
          width: 4px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.4);
          border-radius: 10px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.3);
          border-radius: 10px;
          transition: background-color 0.3s;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.5);
        }
        
        /* Line Clamp */
        .line-clamp-1, .line-clamp-2 {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .line-clamp-1 { -webkit-line-clamp: 1; }
        .line-clamp-2 { -webkit-line-clamp: 2; }
        
        /* Smooth scroll */
        html {
          scroll-behavior: smooth;
        }
        
        /* Animation */
        @keyframes slide-in-from-top {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-in.slide-in-from-top-2 {
          animation: slide-in-from-top 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        /* Prevent text overflow */
        .truncate {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}