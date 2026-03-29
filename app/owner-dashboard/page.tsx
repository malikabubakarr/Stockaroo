"use client";

import { useBranch } from "@/context/BranchContext";
import { useEffect, useState, useCallback, useMemo, memo } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, collection, onSnapshot, query, where, orderBy, writeBatch, limit } from "firebase/firestore";
import { useRouter } from "next/navigation";
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

// Memoized StatsCard - Fully Responsive
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
    <div className="group relative bg-gradient-to-b from-gray-900/95 to-gray-800/90 backdrop-blur-xl p-2 xs:p-3 sm:p-4 rounded-xl border border-white/10 shadow-2xl hover:shadow-3xl hover:-translate-y-0.5 transition-all duration-300 overflow-hidden h-full flex flex-col justify-between min-h-[80px] xs:min-h-[90px] sm:min-h-[100px]">
      <div className="absolute inset-0 bg-gradient-to-r from-white/10 via-transparent to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 -skew-x-12 -translate-x-32 group-hover:translate-x-32 pointer-events-none"></div>
      
      <div className="relative z-10 flex items-center justify-between mb-1 xs:mb-1.5 sm:mb-2">
        <div className="text-gray-300 text-[9px] xs:text-[10px] sm:text-xs font-medium uppercase tracking-wider line-clamp-1 max-w-[60%]">{title}</div>
        <div className="text-gray-400 text-[12px] xs:text-sm sm:text-base opacity-90">{icon}</div>
      </div>
      
      <div className="space-y-0.5 xs:space-y-1 sm:space-y-1.5 flex-1 flex flex-col justify-end">
        <div className="text-[13px] xs:text-sm sm:text-lg md:text-xl font-bold bg-gradient-to-r from-white to-gray-200 bg-clip-text text-transparent drop-shadow-sm line-clamp-1">
          {currencySymbol}{isLoading ? '...' : formatCurrency(sales)}
        </div>
        <div className="text-[9px] xs:text-xs sm:text-sm font-semibold text-white/90 flex items-center gap-0.5 flex-wrap">
          <span className="truncate min-w-0">{currencySymbol}{isLoading ? '...' : formatCurrency(profit)}</span> 
          <span className="text-[8px] xs:text-[10px] sm:text-xs text-gray-300">Profit</span>
        </div>
        <div className="text-[8px] xs:text-[10px] sm:text-xs text-gray-400 font-medium line-clamp-1">{period}</div>
      </div>
    </div>
  );
});

StatsCard.displayName = 'StatsCard';

export default function OwnerDashboard() {
  const router = useRouter();
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
  const [showLogoutMenu, setShowLogoutMenu] = useState(false);
  const [currency, setCurrency] = useState<CurrencyOption>({
    symbol: "$",
    code: "USD",
    name: "US Dollar",
    flag: "🇺🇸"
  });
  const [updatingCurrency, setUpdatingCurrency] = useState(false);
  
  // Stats for invoice and credit blocks
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [creditCount, setCreditCount] = useState(0);

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

  /* ---------------- LOGOUT FUNCTION ---------------- */
  const handleLogout = async () => {
    try {
      localStorage.removeItem("branches_cache");
      localStorage.removeItem("activeBranch");
      localStorage.removeItem("stats_cache");
      localStorage.removeItem("lastLoggedIn");
      localStorage.removeItem("userRole");
      localStorage.removeItem("currency");
      
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };

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
    const cachedBranches = localStorage.getItem("branches_cache");
    if (cachedBranches) {
      try {
        const parsed = JSON.parse(cachedBranches);
        setBranches(parsed);
        
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
        router.push("/login");
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
  }, [router, currency.code, currency.symbol]);

  /* ---------------- UPDATE USER CURRENCY PREFERENCE ---------------- */
  const updateUserCurrency = useCallback(async (selectedCurrency: CurrencyOption) => {
    if (!currentUser?.uid) return;
    
    setUpdatingCurrency(true);
    try {
      const userDocRef = doc(db, "users", currentUser.uid);
      const batch = writeBatch(db);
      
      batch.update(userDocRef, {
        currency: selectedCurrency.code,
        currencySymbol: selectedCurrency.symbol,
        updatedAt: new Date()
      });
      
      branches.forEach((branch) => {
        const branchRef = doc(db, "branches", branch.id);
        batch.update(branchRef, {
          currency: selectedCurrency.code,
          currencySymbol: selectedCurrency.symbol
        });
      });
      
      await batch.commit();
      setCurrency(selectedCurrency);
      
      if (DEBUG) console.log("Currency updated successfully for all branches");
      
    } catch (error) {
      if (DEBUG) console.error("Error updating currency:", error);
    } finally {
      setUpdatingCurrency(false);
      setShowCurrencyMenu(false);
    }
  }, [currentUser?.uid, branches]);

  /* ---------------- STATS LOAD ---------------- */
  useEffect(() => {
    if (!activeBranch?.id || !currentUser?.uid) {
      setLoadingStats(false);
      return;
    }

    const ownerId = currentUser.uid;
    const branchId = activeBranch.id;

    const salesQuery = query(
      collection(db, "sales"),
      where("ownerId", "==", ownerId),
      where("branchId", "==", branchId),
      orderBy("date", "desc"),
      limit(200)
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
      localStorage.setItem("stats_cache", JSON.stringify(statsData));
      setLoadingStats(false);
    });

    return () => unsubscribe();
  }, [activeBranch?.id, currentUser?.uid]);

  /* ---------------- LOAD INVOICE AND CREDIT COUNTS ---------------- */
  useEffect(() => {
    if (!activeBranch?.id || !currentUser?.uid) return;

    const ownerId = currentUser.uid;
    const branchId = activeBranch.id;

    // Count all invoices
    const invoicesQuery = query(
      collection(db, "invoices"),
      where("ownerId", "==", ownerId),
      where("branchId", "==", branchId)
    );

    const unsubscribeInvoices = onSnapshot(invoicesQuery, (snap) => {
      setInvoiceCount(snap.size);
    });

    // Count credit bills (unpaid invoices)
    const creditQuery = query(
      collection(db, "invoices"),
      where("ownerId", "==", ownerId),
      where("branchId", "==", branchId),
      where("paymentStatus", "==", "credit"),
      where("balance", ">", 0)
    );

    const unsubscribeCredit = onSnapshot(creditQuery, (snap) => {
      setCreditCount(snap.size);
    });

    return () => {
      unsubscribeInvoices();
      unsubscribeCredit();
    };
  }, [activeBranch?.id, currentUser?.uid]);

  /* ---------------- SAVE ACTIVE BRANCH ---------------- */
  useEffect(() => {
    if (activeBranch) {
      localStorage.setItem("activeBranch", JSON.stringify(activeBranch));
    }
  }, [activeBranch]);

  /* ---------------- CURRENCY LOCAL STORAGE ---------------- */
  useEffect(() => {
    const savedCurrency = localStorage.getItem("currency");
    if (savedCurrency && !currentUser) {
      try {
        setCurrency(JSON.parse(savedCurrency));
      } catch (e) {}
    }
  }, [currentUser]);

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

  // Memoized branch list
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
          className={`group relative px-2 xs:px-3 sm:px-4 py-1.5 xs:py-2 sm:py-2.5 rounded-lg text-[10px] xs:text-xs sm:text-sm font-bold border-2 shadow-xl transition-all duration-400 flex items-center gap-1 xs:gap-1.5 sm:gap-2 backdrop-blur-xl flex-shrink-0 whitespace-nowrap hover:scale-[1.02] active:scale-[0.98] h-9 xs:h-10 sm:h-11 min-w-[100px] xs:min-w-[110px] sm:min-w-[130px] max-w-[140px] xs:max-w-[160px] sm:max-w-[180px] ${
            activeBranch?.id === branch.id
              ? "bg-gradient-to-r from-white/20 to-white/10 text-white border-white/40 shadow-white/20 shadow-2xl ring-2 sm:ring-4 ring-white/30 backdrop-blur-2xl"
              : "bg-white/10 hover:bg-white/20 text-white/95 border-white/30 hover:border-white/50 hover:shadow-2xl hover:shadow-white/20 backdrop-blur-xl"
          }`}
        >
          <span className="truncate block font-semibold text-[9px] xs:text-xs sm:text-sm max-w-[70%]">
            {branch.shopName.length > 10 ? `${branch.shopName.slice(0, 10)}...` : branch.shopName}
          </span>
          {branch.isMain && (
            <span className="text-[8px] xs:text-[10px] sm:text-xs bg-white/20 backdrop-blur-sm text-white px-1 xs:px-1.5 py-0.5 rounded-full font-bold shadow-md ml-auto flex-shrink-0">
              ⭐
            </span>
          )}
          {branch.currency && branch.currency !== currency.code && (
            <span className="text-[8px] xs:text-[10px] sm:text-xs bg-white/10 backdrop-blur-sm text-white/80 px-0.5 xs:px-1 py-0.5 rounded-full ml-0.5 flex-shrink-0">
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
        <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 gap-1.5 xs:gap-2 sm:gap-3 w-full">
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
      <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 gap-1.5 xs:gap-2 sm:gap-3 w-full">
        {Array(4).fill(0).map((_, i) => (
          <div key={i} className="group relative bg-gradient-to-b from-gray-900/80 to-gray-800/70 backdrop-blur-xl p-2 xs:p-3 sm:p-4 rounded-xl border border-white/10 shadow-2xl animate-pulse h-full flex flex-col justify-between min-h-[80px] xs:min-h-[90px] sm:min-h-[100px]">
            <div className="flex items-center justify-between mb-1 xs:mb-1.5 sm:mb-2">
              <div className="h-2 xs:h-2.5 sm:h-3 bg-white/30 rounded-full w-8 xs:w-10 sm:w-14"></div>
              <div className="w-4 h-4 xs:w-5 xs:h-5 sm:w-6 sm:h-6 bg-white/20 rounded-lg xs:rounded-xl"></div>
            </div>
            <div className="space-y-0.5 xs:space-y-1 sm:space-y-1.5">
              <div className="h-4 xs:h-5 sm:h-7 bg-white/20 rounded-lg xs:rounded-xl w-16 xs:w-20 sm:w-24"></div>
              <div className="h-2 xs:h-3 sm:h-4 bg-white/20 rounded-full w-12 xs:w-16 sm:w-20"></div>
              <div className="h-1.5 xs:h-2 sm:h-3 bg-white/15 rounded w-10 xs:w-12 sm:w-16"></div>
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
        className="group relative bg-white/90 hover:bg-white backdrop-blur-xl p-2.5 xs:p-3 sm:p-4 md:p-5 rounded-xl border border-gray-200/60 hover:border-gray-300 shadow-lg hover:shadow-2xl hover:shadow-gray-200/50 hover:-translate-y-1 transition-all duration-400 overflow-hidden text-center h-full min-h-[80px] xs:min-h-[90px] sm:min-h-[100px] md:min-h-[110px] flex flex-col justify-center items-stretch"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white/20 via-transparent to-white/10 opacity-0 group-hover:opacity-100 transition-all duration-700 -skew-x-12 -translate-x-full group-hover:translate-x-full pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col items-center gap-1.5 xs:gap-2 sm:gap-2.5 h-full justify-center pb-1 xs:pb-1.5 sm:pb-2">
          <div className="w-10 h-10 xs:w-11 xs:h-11 sm:w-12 sm:h-12 md:w-14 md:h-14 bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-2xl group-hover:scale-110 transition-all duration-400 backdrop-blur-sm border border-white/20 hover:border-white/40">
            <span className="text-xl xs:text-2xl sm:text-3xl">{icon}</span>
          </div>
          <div className="space-y-0.5 px-1 xs:px-1.5 sm:px-2 w-full">
            <p className="font-bold text-[11px] xs:text-xs sm:text-sm md:text-base text-gray-900 leading-tight line-clamp-2 group-hover:text-gray-950">
              {title}
            </p>
            <p className="text-[9px] xs:text-[10px] sm:text-xs text-gray-600 font-semibold tracking-wide line-clamp-2">
              {subtitle}
            </p>
          </div>
        </div>
      </Link>
    ));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 text-gray-900">
      <header className="bg-gradient-to-b from-gray-900 via-gray-900/95 to-gray-900/90 text-white shadow-2xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          {/* TOP BAR */}
          <div className="flex items-center justify-between py-4">
            {/* LEFT: LOGO */}
            <div className="flex items-center gap-3">
              <Image
                src="/stockaro-logo.png"
                alt="Stockaroo"
                width={40}
                height={40}
                className="rounded-xl shadow-lg"
              />
              <h1 className="text-lg sm:text-2xl font-bold">Stockaroo</h1>
            </div>

            {/* RIGHT ACTIONS */}
            <div className="flex items-center gap-3">
              {/* PROFILE */}
              <div>
                <button onClick={() => setShowLogoutMenu(!showLogoutMenu)}>
                  <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center font-bold">
                    {getInitials(ownerName)}
                  </div>
                </button>
              </div>

              {/* CURRENCY */}
              <div>
                <button
                  onClick={() => setShowCurrencyMenu(!showCurrencyMenu)}
                  className="flex items-center gap-2 bg-white/10 px-3 py-2 rounded-xl"
                >
                  <span>{currency.flag}</span>
                  <span>{currency.symbol}</span>
                </button>
              </div>
            </div>
          </div>

          {/* BRANCH SCROLL */}
          {branches.length > 0 && (
            <div className="pb-4 overflow-x-auto">
              <div className="flex gap-3 py-2 min-w-max">
                {branchElements}
              </div>
            </div>
          )}

          {/* STATS */}
          <div className="pb-6">
            {statsCards}
          </div>
        </div>

        {/* DROPDOWNS */}
        {showLogoutMenu && (
          <>
            <div
              className="fixed inset-0 z-[9998] bg-black/20"
              onClick={() => setShowLogoutMenu(false)}
            />
            <div className="fixed top-16 right-4 sm:right-6 z-[9999] w-[90vw] max-w-xs bg-white text-black rounded-2xl shadow-2xl border overflow-hidden">
              <div className="p-4 border-b">
                <p className="text-xs text-gray-500">Signed in as</p>
                <p className="font-semibold truncate">{ownerName}</p>
                <p className="text-xs text-gray-500 truncate">{currentUser?.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-3 text-red-600 hover:bg-red-50"
              >
                Sign Out
              </button>
            </div>
          </>
        )}

        {showCurrencyMenu && (
          <>
            <div
              className="fixed inset-0 z-[9998] bg-black/20"
              onClick={() => setShowCurrencyMenu(false)}
            />
            <div className="fixed top-16 right-4 sm:right-6 z-[9999] w-[90vw] max-w-sm bg-white text-black rounded-2xl shadow-2xl border">
              <div className="p-4 max-h-[70vh] overflow-y-auto">
                <h3 className="text-sm font-bold mb-3 text-center">
                  🌍 Select Currency
                </h3>
                <div className="space-y-2">
                  {currencies.map((cur) => (
                    <button
                      key={cur.code}
                      onClick={() => updateUserCurrency(cur)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-100"
                    >
                      <span>{cur.flag}</span>
                      <div className="flex-1 text-left">
                        <div className="font-semibold">{cur.name}</div>
                        <div className="text-xs text-gray-500">{cur.code}</div>
                      </div>
                      <span className="font-bold">{cur.symbol}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </header>
      
      {/* MAIN CONTENT */}
      <main className="w-full flex-grow pb-8 xs:pb-12 sm:pb-16">
        <div className="w-full px-2 xs:px-3 sm:px-4 md:px-6 lg:px-8 max-w-7xl mx-auto pt-2 xs:pt-4 sm:pt-6">
          
          {/* Quick Action Cards */}
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span>⚡</span> Quick Actions
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2 xs:gap-3 sm:gap-4 md:gap-5 auto-rows-fr">
              {menuCards}
            </div>
          </div>

          {/* Invoices and Credit Bills Blocks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
            {/* Invoices Block */}
            <Link href="/wholesale-sales">
              <div className="group bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl shadow-xl overflow-hidden cursor-pointer transform transition-all duration-300 hover:scale-105 hover:shadow-2xl">
                <div className="p-6 md:p-8">
                  <div className="flex items-center justify-between mb-4">
                    <div className="bg-white/20 backdrop-blur-sm rounded-full p-3">
                      <span className="text-3xl">📄</span>
                    </div>
                    <div className="text-right">
                      <p className="text-white/80 text-sm">Total Invoices</p>
                      <p className="text-white text-4xl font-bold">{invoiceCount}</p>
                    </div>
                  </div>
                  <h3 className="text-white text-2xl font-bold mb-2">Invoices</h3>
                  <p className="text-blue-100 text-sm mb-4">View and manage all invoices</p>
                  <div className="flex items-center text-white/80 group-hover:text-white transition">
                    <span className="text-sm">View Details</span>
                    <span className="ml-2 group-hover:translate-x-2 transition">→</span>
                  </div>
                </div>
                <div className="h-1 bg-white/30 w-full transform origin-left scale-x-0 group-hover:scale-x-100 transition duration-300"></div>
              </div>
            </Link>

            {/* Credit Bills Block */}
            <Link href="/credit-list">
              <div className="group bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl shadow-xl overflow-hidden cursor-pointer transform transition-all duration-300 hover:scale-105 hover:shadow-2xl">
                <div className="p-6 md:p-8">
                  <div className="flex items-center justify-between mb-4">
                    <div className="bg-white/20 backdrop-blur-sm rounded-full p-3">
                      <span className="text-3xl">⚠️</span>
                    </div>
                    <div className="text-right">
                      <p className="text-white/80 text-sm">Pending Credit Bills</p>
                      <p className="text-white text-4xl font-bold">{creditCount}</p>
                    </div>
                  </div>
                  <h3 className="text-white text-2xl font-bold mb-2">Credit Bills</h3>
                  <p className="text-orange-100 text-sm mb-4">Track and manage credit payments</p>
                  <div className="flex items-center text-white/80 group-hover:text-white transition">
                    <span className="text-sm">View Details</span>
                    <span className="ml-2 group-hover:translate-x-2 transition">→</span>
                  </div>
                </div>
                <div className="h-1 bg-white/30 w-full transform origin-left scale-x-0 group-hover:scale-x-100 transition duration-300"></div>
              </div>
            </Link>
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="bg-gradient-to-t from-gray-900/95 via-gray-900/90 to-gray-900/80 text-white/95 border-t border-white/10 backdrop-blur-2xl shadow-2xl">
        <div className="w-full px-2 xs:px-3 sm:px-4 md:px-6 lg:px-8 max-w-7xl mx-auto py-4 xs:py-6 sm:py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 xs:gap-4 sm:gap-6">
            {/* Logo & Branding */}
            <div className="flex items-center gap-2 xs:gap-3 sm:gap-4 text-center sm:text-left order-2 sm:order-1 flex-shrink-0">
              <div className="relative flex-shrink-0">
                <Image
                  src="/stockaro-logo.png"
                  alt="Stockaroo"
                  width={32}
                  height={32}
                  className="w-8 h-8 xs:w-9 xs:h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 lg:w-14 lg:h-14 object-contain shadow-2xl rounded-xl sm:rounded-2xl"
                  priority
                />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg xs:text-xl sm:text-2xl md:text-3xl font-black bg-gradient-to-r from-white via-gray-100 to-gray-200 bg-clip-text text-transparent leading-tight truncate">
                  Stockaroo
                </h3>
                <p className="text-[10px] xs:text-xs sm:text-sm md:text-base text-gray-400/80 font-semibold mt-0.5 xs:mt-1">
                  © {new Date().getFullYear()} All rights reserved
                </p>
              </div>
            </div>

            {/* Active Branch & Currency */}
            <div className="flex flex-col xs:flex-row items-center gap-2 xs:gap-3 w-full sm:w-auto justify-center sm:justify-start order-1 sm:order-2 bg-white/5 backdrop-blur-xl border border-white/20 rounded-xl sm:rounded-2xl px-3 xs:px-4 sm:px-5 md:px-6 py-3 xs:py-4 shadow-xl">
              <div className="flex items-center gap-1 xs:gap-1.5 p-1.5 xs:p-2 bg-white/10 rounded-lg xs:rounded-xl border border-white/20 min-w-[44px] xs:min-w-[50px] sm:min-w-[60px] justify-center flex-shrink-0">
                <span className="text-lg xs:text-xl sm:text-2xl md:text-3xl flex-shrink-0">{currency.flag}</span>
                <span className="text-base xs:text-lg sm:text-xl md:text-2xl font-black bg-gradient-to-r from-white to-gray-200 bg-clip-text text-transparent flex-shrink-0">
                  {currency.symbol}
                </span>
              </div>

              <div className="flex flex-col items-center xs:items-start min-w-0 flex-1 max-w-[200px] xs:max-w-[250px] sm:max-w-none">
                <span className="text-[9px] xs:text-[10px] sm:text-xs uppercase tracking-wider text-gray-400 font-semibold bg-white/10 px-1.5 xs:px-2 py-0.5 rounded-full border border-white/20 flex-shrink-0">
                  Active Branch
                </span>
                <span className="text-xs xs:text-sm sm:text-base md:text-lg font-black text-white truncate max-w-full bg-gradient-to-r from-gray-100 to-gray-200 bg-clip-text text-transparent">
                  {activeBranch?.shopName || "Select a Branch"}
                </span>
              </div>

              {!isOffline ? (
                <div className="flex items-center gap-1 xs:gap-1.5 p-1.5 xs:p-2 bg-white/10 rounded-lg xs:rounded-xl border border-white/20 flex-shrink-0">
                  <div className="w-2 h-2 xs:w-2.5 xs:h-2.5 md:w-3 md:h-3 bg-emerald-400 rounded-full shadow-lg flex-shrink-0"></div>
                  <span className="text-[10px] xs:text-xs sm:text-sm font-bold text-white/90 hidden xs:inline truncate">Online</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 xs:gap-1.5 p-1.5 xs:p-2 bg-white/5 rounded-lg xs:rounded-xl border border-white/20 animate-pulse flex-shrink-0">
                  <div className="w-2 h-2 xs:w-2.5 xs:h-2.5 md:w-3 md:h-3 bg-gray-400 rounded-full shadow-lg flex-shrink-0"></div>
                  <span className="text-[10px] xs:text-xs sm:text-sm font-bold text-white/70 hidden xs:inline truncate">Offline</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </footer>

      {/* Global Styles */}
      <style jsx global>{`
        .scrollbar-thin::-webkit-scrollbar {
          height: 3px;
          width: 3px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.4);
          border-radius: 10px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.3);
          border-radius: 10px;
        }
        .line-clamp-1, .line-clamp-2 {
          display: -webkit-box;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .line-clamp-1 { -webkit-line-clamp: 1; }
        .line-clamp-2 { -webkit-line-clamp: 2; }
        html {
          scroll-behavior: smooth;
        }
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
        .truncate {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}