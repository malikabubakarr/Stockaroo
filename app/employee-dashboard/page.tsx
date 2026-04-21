"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  updateDoc,
  doc,
  increment,
  writeBatch,
  limit,
  getDoc
} from "firebase/firestore";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Debug mode - set to false in production
const DEBUG = false;

interface Product {
  id: string;
  name: string;
  saleRate: number;
  qty: number;
  unit: string;
  profit: number;
  purchaseRate: number;
  allowSale: boolean;
  category: string;
  branchId: string;
}

interface CartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
  unit: string;
  profit: number;
  purchaseRate: number;
}

interface OfflineSale {
  ownerId: string;
  ownerName: string;
  branchId: string;
  branchName: string;
  employeeId: string;
  employeeName: string;
  createdBy: string;
  role: string;
  items: CartItem[];
  totalAmount: number;
  totalProfit: number;
  discount: number;
  discountType: "flat" | "percent";
  type: string;
  date: string;
  createdAt: string | any;
  localId?: number;
}

export default function EmployeeDashboard() {
  const router = useRouter();
  const [employeeName, setEmployeeName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [branchName, setBranchName] = useState("");
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [employeeData, setEmployeeData] = useState<any>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState({ title: "", message: "", type: "success" });
  
  // Discount state
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<"flat" | "percent">("flat");

  // Refs
  const syncInProgress = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Helper functions for user-centric structure
  const getProductsCollection = (userId: string) => {
    return collection(db, "users", userId, "products");
  };

  const getProductDoc = (userId: string, productId: string) => {
    return doc(db, "users", userId, "products", productId);
  };

  const getSalesCollection = (userId: string) => {
    return collection(db, "users", userId, "sales");
  };

  // Show toast notification
  const showNotification = useCallback((title: string, message: string, type: "success" | "error" | "info" = "success") => {
    setToastMessage({ title, message, type });
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  }, []);

  // Handle sign out
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      showNotification("Signed Out", "You have been signed out successfully", "success");
      router.push("/login");
    } catch (error) {
      console.error("Sign out error:", error);
      showNotification("Error", "Failed to sign out", "error");
    }
  };

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Focus search input on Ctrl+K or Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Detect offline / online
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

  // Auto-sync offline sales when online
  useEffect(() => {
    const syncOfflineSales = async () => {
      if (!isOffline && ownerId && branchId && !syncInProgress.current) {
        syncInProgress.current = true;
        try {
          const offlineSalesJson = localStorage.getItem("employee_offline_sales");
          if (!offlineSalesJson) {
            syncInProgress.current = false;
            return;
          }

          const offlineSales: OfflineSale[] = JSON.parse(offlineSalesJson);
          if (offlineSales.length === 0) {
            syncInProgress.current = false;
            return;
          }

          showNotification("Syncing", `Syncing ${offlineSales.length} offline sales...`, "info");

          for (const sale of offlineSales) {
            try {
              const saleData = { ...sale };
              delete saleData.localId;
              saleData.date = serverTimestamp() as any;
              saleData.createdAt = serverTimestamp() as any;
              
              const salesRef = getSalesCollection(ownerId);
              await addDoc(salesRef, saleData);
              
              const batch = writeBatch(db);
              for (const item of sale.items) {
                const productRef = getProductDoc(ownerId, item.id);
                batch.update(productRef, {
                  qty: increment(-item.qty)
                });
              }
              await batch.commit();
            } catch (err) {
              if (DEBUG) console.error("Error syncing offline sale:", err);
            }
          }

          localStorage.removeItem("employee_offline_sales");
          showNotification("Sync Complete", "All offline sales have been synced", "success");
          
          await loadProducts();
        } catch (err) {
          if (DEBUG) console.error("Error in sync process:", err);
        } finally {
          syncInProgress.current = false;
        }
      }
    };

    syncOfflineSales();
  }, [isOffline, ownerId, branchId]);

  // Load products from user-centric subcollection based on branch
  const loadProducts = useCallback(async () => {
    if (!branchId || !ownerId) {
      if (DEBUG) console.log("Missing branchId or ownerId for loading products");
      return;
    }
    
    try {
      if (DEBUG) console.log("Loading products for owner:", ownerId, "branch:", branchId);
      
      const productsRef = getProductsCollection(ownerId);
      const prodQuery = query(
        productsRef,
        where("branchId", "==", branchId),
        where("allowSale", "==", true)
      );

      const prodSnap = await getDocs(prodQuery);

      const list = prodSnap.docs.map(d => ({
        id: d.id,
        name: d.data().name,
        saleRate: d.data().saleRate,
        qty: d.data().qty,
        unit: d.data().unit,
        profit: d.data().profit || 0,
        purchaseRate: d.data().purchaseRate || 0,
        allowSale: d.data().allowSale,
        category: d.data().category || "",
        branchId: d.data().branchId,
      })) as Product[];

      if (DEBUG) console.log(`Loaded ${list.length} products for branch ${branchId}`);
      setProducts(list);
      
      localStorage.setItem(`employee_products_cache_${branchId}`, JSON.stringify(list));
    } catch (error) {
      if (DEBUG) console.error("Error loading products:", error);
      showNotification("Error", "Failed to load products", "error");
    }
  }, [branchId, ownerId, showNotification]);

  // Load employee data and products
  useEffect(() => {
    const loadCachedProducts = () => {
      const cachedBranchId = localStorage.getItem("employee_branch_id");
      if (cachedBranchId) {
        const cachedProducts = localStorage.getItem(`employee_products_cache_${cachedBranchId}`);
        if (cachedProducts) {
          try {
            setProducts(JSON.parse(cachedProducts));
            if (DEBUG) console.log("Loaded products from cache");
          } catch (e) {
            if (DEBUG) console.error("Error parsing products cache:", e);
          }
        }
      }
    };
    
    loadCachedProducts();

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      const uid = user.uid;

      try {
        const usersRef = collection(db, "users");
        const userQuery = query(usersRef, where("uid", "==", uid), limit(1));
        const userSnap = await getDocs(userQuery);
        
        if (!userSnap.empty) {
          const userData = userSnap.docs[0].data();
          
          if (userData.role === "employee") {
            const foundOwnerId = userData.ownerId;
            const foundBranchId = userData.branchId;
            
            setEmployeeName(userData.username || userData.name || "Employee");
            setEmployeeId(uid);
            setBranchId(foundBranchId);
            setBranchName(userData.branchName || "");
            setOwnerName(userData.ownerName || "");
            setOwnerId(foundOwnerId);
            
            localStorage.setItem("employee_branch_id", foundBranchId);
            localStorage.setItem("employee_owner_id", foundOwnerId);
            
            if (DEBUG) console.log("Employee data loaded from users collection");
            
            await loadProducts();
            setIsLoading(false);
            return;
          }
        }
        
        const empQuery = query(
          collection(db, "allEmployees"),
          where("uid", "==", uid),
          limit(1)
        );
        
        const empSnap = await getDocs(empQuery);
        
        if (!empSnap.empty) {
          const emp = empSnap.docs[0].data();
          
          setEmployeeName(emp.name || emp.username || "Employee");
          setEmployeeId(uid);
          setBranchId(emp.branchId);
          setBranchName(emp.branchName || "");
          setOwnerName(emp.ownerName || "");
          setOwnerId(emp.ownerId || "");
          
          localStorage.setItem("employee_branch_id", emp.branchId);
          localStorage.setItem("employee_owner_id", emp.ownerId || "");
          
          if (DEBUG) console.log("Employee data loaded from allEmployees collection");
          await loadProducts();
        } else {
          console.error("No employee data found for user:", uid);
          showNotification("Error", "Employee profile not found. Please contact admin.", "error");
        }
      } catch (error) {
        if (DEBUG) console.error("Error loading employee data:", error);
        showNotification("Error", "Failed to load employee data", "error");
      } finally {
        setIsLoading(false);
      }
    });

    return () => unsub();
  }, [loadProducts, showNotification]);

  // Get unique categories (memoized)
  const categories = useMemo(() => {
    return ["all", ...new Set(products.map(p => p.category).filter(Boolean))];
  }, [products]);

  // Filter products (memoized with debounced search)
  const filteredProducts = useMemo(() => {
    return products.filter(p => 
      p.name.toLowerCase().includes(debouncedSearch.toLowerCase()) &&
      (selectedCategory === "all" || p.category === selectedCategory) &&
      p.qty > 0 && p.allowSale
    );
  }, [products, debouncedSearch, selectedCategory]);

  // Add product to cart with quick quantity selection
  const addToCart = useCallback((product: Product, customQty?: number) => {
    if (product.qty <= 0) {
      showNotification("Out of Stock", "Product is out of stock", "error");
      return;
    }

    const quantity = customQty || 1;

    if (quantity > product.qty) {
      showNotification("Stock Limit", `Maximum available stock: ${product.qty} ${product.unit}`, "error");
      return;
    }

    setCart(prev => {
      const exist = prev.find(p => p.id === product.id);

      if (exist) {
        const newQty = exist.qty + quantity;
        if (newQty > product.qty) {
          showNotification("Stock Limit", `Maximum available stock: ${product.qty} ${product.unit}`, "error");
          return prev;
        }
        showNotification("Cart Updated", `${product.name} quantity increased by ${quantity}`, "success");
        return prev.map(p =>
          p.id === product.id ? { ...p, qty: newQty } : p
        );
      } else {
        showNotification("Item Added", `${product.name} added to cart`, "success");
        return [...prev, { 
          id: product.id, 
          name: product.name, 
          price: product.saleRate, 
          qty: quantity,
          unit: product.unit,
          profit: product.profit,
          purchaseRate: product.purchaseRate
        }];
      }
    });
  }, [showNotification]);

  // Quick add with +1 button
  const quickAddToCart = useCallback((product: Product, e: React.MouseEvent) => {
    e.stopPropagation();
    addToCart(product, 1);
  }, [addToCart]);

  // Update cart quantity
  const updateCartQty = useCallback((productId: string, newQty: number) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    if (newQty <= 0) {
      removeFromCart(productId);
      return;
    }

    if (newQty > product.qty) {
      showNotification("Stock Limit", `Maximum available stock: ${product.qty} ${product.unit}`, "error");
      return;
    }

    setCart(prev =>
      prev.map(item =>
        item.id === productId ? { ...item, qty: newQty } : item
      )
    );
  }, [products, showNotification]);

  // Remove from cart
  const removeFromCart = useCallback((productId: string) => {
    const item = cart.find(c => c.id === productId);
    if (item) {
      showNotification("Item Removed", `${item.name} removed from cart`, "info");
    }
    setCart(prev => prev.filter(item => item.id !== productId));
  }, [cart, showNotification]);

  // Clear cart
  const clearCart = useCallback(() => {
    if (cart.length > 0 && confirm("Are you sure you want to clear the cart?")) {
      setCart([]);
      setDiscount(0);
      showNotification("Cart Cleared", "All items have been removed", "info");
    }
  }, [cart, showNotification]);

  // Calculate totals with discount (memoized)
  const totals = useMemo(() => {
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    
    let discountAmount = 0;
    if (discountType === "flat") {
      discountAmount = Math.min(discount, subtotal);
    } else {
      discountAmount = (subtotal * discount) / 100;
    }
    
    discountAmount = Math.min(discountAmount, subtotal);
    const totalAmount = subtotal - discountAmount;

    return { 
      subtotal, 
      discountAmount, 
      totalAmount
    };
  }, [cart, discount, discountType]);

  // Complete sale with offline support
  const completeSale = useCallback(async () => {
    if (cart.length === 0) {
      showNotification("Empty Cart", "Please add items to cart first", "error");
      return;
    }

    if (!ownerId || !branchId) {
      showNotification("Error", "Missing owner or branch information", "error");
      return;
    }

    setIsProcessing(true);

    try {
      for (const item of cart) {
        const product = products.find(p => p.id === item.id);
        if (!product) {
          showNotification("Stock Error", `Product ${item.name} not found`, "error");
          setIsProcessing(false);
          return;
        }
        if (product.qty < item.qty) {
          showNotification("Stock Error", `Insufficient stock for ${item.name}. Available: ${product.qty} ${product.unit}`, "error");
          setIsProcessing(false);
          return;
        }
      }

      const totalProfit = cart.reduce((sum, item) => sum + (item.profit || 0) * item.qty, 0);
      let discountAmount = 0;
      if (discountType === "flat") {
        discountAmount = Math.min(discount, totals.subtotal);
      } else {
        discountAmount = (totals.subtotal * discount) / 100;
      }
      discountAmount = Math.min(discountAmount, totals.subtotal);
      const finalProfit = totalProfit - discountAmount;

      if (isOffline) {
        const offlineSalesJson = localStorage.getItem("employee_offline_sales");
        const offlineSales: OfflineSale[] = offlineSalesJson ? JSON.parse(offlineSalesJson) : [];

        const saleData: OfflineSale = {
          ownerId,
          ownerName,
          branchId,
          branchName,
          employeeId,
          employeeName,
          createdBy: employeeName,
          role: "employee",
          items: cart,
          totalAmount: totals.totalAmount,
          totalProfit: finalProfit,
          discount: discountAmount,
          discountType,
          type: "employee_sale",
          date: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          localId: Date.now(),
        };

        offlineSales.push(saleData);
        localStorage.setItem("employee_offline_sales", JSON.stringify(offlineSales));

        showNotification("Saved Offline", "Sale saved locally. Will sync when online.", "info");
        
        setCart([]);
        setDiscount(0);
        setDiscountType("flat");
        setIsProcessing(false);
        return;
      }

      const batch = writeBatch(db);

      for (const item of cart) {
        const productRef = getProductDoc(ownerId, item.id);
        batch.update(productRef, {
          qty: increment(-item.qty)
        });
      }

      const salesRef = getSalesCollection(ownerId);
      const saleRef = doc(salesRef);
      batch.set(saleRef, {
        ownerId,
        ownerName,
        branchId,
        branchName,
        employeeId,
        employeeName,
        createdBy: employeeName,
        role: "employee",
        items: cart.map(item => ({
          id: item.id,
          name: item.name,
          qty: item.qty,
          price: item.price,
          unit: item.unit,
          profit: item.profit || 0,
          purchaseRate: item.purchaseRate || 0,
          total: item.price * item.qty,
          itemProfit: (item.profit || 0) * item.qty
        })),
        totalAmount: totals.totalAmount,
        totalProfit: finalProfit,
        discount: discountAmount,
        discountType,
        type: "employee_sale",
        date: serverTimestamp(),
        createdAt: serverTimestamp()
      });

      await batch.commit();

      showNotification("Sale Completed!", `Total: ₨${formatCurrency(totals.totalAmount)}`, "success");

      setCart([]);
      setDiscount(0);
      setDiscountType("flat");

      await loadProducts();

    } catch (error) {
      if (DEBUG) console.error("Error completing sale:", error);
      showNotification("Error", "Failed to complete sale. Please try again.", "error");
    } finally {
      setIsProcessing(false);
    }
  }, [cart, products, isOffline, ownerId, ownerName, branchId, branchName, employeeId, employeeName, totals, discountType, discount, showNotification, loadProducts]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PK', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getInitials = useCallback((name: string) => {
    return name
      .split(" ")
      .map(n => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-900 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading Employee Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      
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

      {/* Processing Overlay */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl p-8 shadow-2xl text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-900 border-t-transparent mx-auto mb-4"></div>
            <p className="text-lg font-semibold text-gray-900">Processing Sale...</p>
            <p className="text-sm text-gray-500 mt-2">Please wait</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-gradient-to-b from-gray-900 via-gray-900/95 to-gray-900/90 text-white shadow-2xl backdrop-blur-2xl border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between py-4 sm:py-5 gap-3">
            
            {/* Logo & Title */}
            <div className="flex items-center gap-3">
              <Link href="/" className="relative group">
                <Image
                  src="/stockaro-logo.png"
                  alt="Stockaroo"
                  width={40}
                  height={40}
                  className="w-10 h-10 sm:w-11 sm:h-11 object-contain rounded-xl shadow-lg group:hover:scale-110 transition-all duration-300"
                  priority
                />
              </Link>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-200 bg-clip-text text-transparent">
                  Employee Sales
                </h1>
                <p className="text-sm text-gray-300">
                  {branchName || "Loading branch..."}
                </p>
              </div>
            </div>

            {/* Employee Info & Actions */}
            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/20">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-bold text-white">
                  {getInitials(employeeName)}
                </div>
                <div className="text-sm">
                  <div className="font-semibold">{employeeName || "Employee"}</div>
                  <div className="text-xs text-gray-300">Selling for {ownerName || "Owner"}</div>
                </div>
              </div>

              {/* Sign Out Button */}
              <button
                onClick={handleSignOut}
                className="bg-red-500/20 hover:bg-red-500/30 backdrop-blur-xl border border-red-500/30 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2"
              >
                <span>🚪</span> Sign Out
              </button>

              {/* Offline Badge */}
              {isOffline && (
                <div className="bg-yellow-500/20 backdrop-blur-xl border border-yellow-500/30 text-yellow-300 text-sm px-4 py-2 rounded-xl font-semibold shadow-xl animate-pulse">
                  📴 Offline Mode
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Products Section - 2 columns */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/60 p-6">
              {/* Search with keyboard shortcut hint */}
              <div className="relative group mb-4">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search products... (Ctrl+K)"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-24 py-3 bg-white/90 backdrop-blur-xl border border-gray-200/60 hover:border-gray-300 focus:ring-4 focus:ring-gray-200/50 focus:border-gray-400 rounded-xl transition-all duration-300 outline-none placeholder-gray-500"
                />
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400">
                  🔍
                </div>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-md">
                  ⌘K
                </div>
              </div>

              {/* Category Filter */}
              {categories.length > 1 && (
                <div className="mb-4 flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 whitespace-nowrap ${
                        selectedCategory === cat
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {cat === "all" ? "All Products" : cat}
                    </button>
                  ))}
                </div>
              )}

              {/* Products Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[600px] overflow-y-auto pr-2 scrollbar-thin">
                {filteredProducts.length === 0 ? (
                  <div className="col-span-2 text-center py-12">
                    <div className="text-6xl mb-4">📦</div>
                    <p className="text-gray-400 font-medium">No products available</p>
                    <p className="text-xs text-gray-400 mt-2">Products will appear here once added by the owner</p>
                  </div>
                ) : (
                  filteredProducts.map(product => (
                    <div
                      key={product.id}
                      className={`p-4 rounded-xl border transition-all duration-300 ${
                        product.qty === 0 || isProcessing
                          ? 'bg-gray-100 border-gray-200 cursor-not-allowed opacity-50'
                          : 'bg-white hover:bg-gray-50 border-gray-200 hover:border-gray-900 hover:shadow-lg'
                      }`}
                    >
                      <div 
                        className="cursor-pointer"
                        onClick={() => addToCart(product)}
                      >
                        <div className="font-semibold text-gray-900 mb-1">{product.name}</div>
                        <div className="flex justify-between items-center">
                          <span className="text-lg font-bold text-gray-900">
                            ₨{formatCurrency(product.saleRate)}
                          </span>
                          <span className="text-xs text-gray-500">
                            Stock: {product.qty} {product.unit}
                          </span>
                        </div>
                        {product.qty <= 5 && product.qty > 0 && (
                          <div className="mt-2 text-xs text-orange-600 font-semibold">
                            ⚠️ Only {product.qty} {product.unit} left
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => quickAddToCart(product, e)}
                        disabled={product.qty === 0 || isProcessing}
                        className="mt-3 w-full bg-gray-900 hover:bg-gray-800 text-white py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        + Add to Cart
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Cart Section - 1 column */}
          <div className="lg:col-span-1">
            <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/60 p-6 sticky top-28">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">Current Sale</h2>
                <div className="flex items-center gap-2">
                  <span className="bg-gray-900 text-white px-3 py-1 rounded-full text-sm font-semibold">
                    {cart.length} {cart.length === 1 ? 'item' : 'items'}
                  </span>
                  {cart.length > 0 && (
                    <button
                      onClick={clearCart}
                      disabled={isProcessing}
                      className="text-red-500 hover:text-red-700 text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      Clear All
                    </button>
                  )}
                </div>
              </div>

              {/* Discount Section */}
              {cart.length > 0 && (
                <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Apply Discount</h3>
                  <div className="flex gap-2">
                    <select
                      value={discountType}
                      onChange={(e) => setDiscountType(e.target.value as "flat" | "percent")}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold bg-white focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900 outline-none"
                      disabled={isProcessing}
                    >
                      <option value="flat">Flat (₨)</option>
                      <option value="percent">Percentage (%)</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      max={discountType === "flat" ? totals.subtotal : 100}
                      value={discount}
                      onChange={(e) => setDiscount(Number(e.target.value))}
                      placeholder="0"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-right font-semibold focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900 outline-none"
                      disabled={isProcessing}
                    />
                  </div>
                </div>
              )}

              {/* Cart Items */}
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2 mb-4 scrollbar-thin">
                {cart.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-6xl mb-4">🛒</div>
                    <p className="text-gray-400 font-medium">Cart is empty</p>
                    <p className="text-xs text-gray-400 mt-2">Click on products to add</p>
                  </div>
                ) : (
                  cart.map(item => {
                    const product = products.find(p => p.id === item.id);
                    return (
                      <div key={item.id} className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="font-semibold text-gray-900">{item.name}</div>
                            <div className="text-xs text-gray-500">{item.unit}</div>
                          </div>
                          <button
                            onClick={() => removeFromCart(item.id)}
                            disabled={isProcessing}
                            className="text-red-500 hover:text-red-700 disabled:opacity-50 transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateCartQty(item.id, item.qty - 1)}
                              disabled={isProcessing}
                              className="w-8 h-8 bg-gray-200 rounded-lg hover:bg-gray-300 flex items-center justify-center font-bold disabled:opacity-50 transition-colors"
                            >
                              -
                            </button>
                            <span className="font-semibold w-8 text-center">{item.qty}</span>
                            <button
                              onClick={() => updateCartQty(item.id, item.qty + 1)}
                              disabled={isProcessing || (product && item.qty >= product.qty)}
                              className="w-8 h-8 bg-gray-200 rounded-lg hover:bg-gray-300 flex items-center justify-center font-bold disabled:opacity-50 transition-colors"
                            >
                              +
                            </button>
                          </div>
                          <span className="font-bold text-gray-900">
                            ₨{formatCurrency(item.price * item.qty)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Total and Checkout */}
              {cart.length > 0 && (
                <div className="border-t border-gray-200 pt-4">
                  {/* Subtotal */}
                  <div className="flex justify-between items-center mb-2 text-sm">
                    <span className="text-gray-600">Subtotal:</span>
                    <span className="font-semibold text-gray-900">
                      ₨{formatCurrency(totals.subtotal)}
                    </span>
                  </div>
                  
                  {/* Discount */}
                  {totals.discountAmount > 0 && (
                    <div className="flex justify-between items-center mb-2 text-sm">
                      <span className="text-gray-600">Discount:</span>
                      <span className="font-semibold text-red-600">
                        -₨{formatCurrency(totals.discountAmount)}
                      </span>
                    </div>
                  )}
                  
                  {/* Total Amount */}
                  <div className="flex justify-between items-center mb-4 pt-2 border-t border-gray-200">
                    <span className="text-gray-900 font-bold">Total Amount:</span>
                    <span className="text-2xl font-bold text-gray-900">
                      ₨{formatCurrency(totals.totalAmount)}
                    </span>
                  </div>

                  {/* Info Box */}
                  <div className="bg-blue-50 p-3 rounded-xl mb-4 border border-blue-200">
                    <p className="text-xs text-blue-800 space-y-1">
                      <div><span className="font-semibold">Employee:</span> {employeeName}</div>
                      <div><span className="font-semibold">Owner:</span> {ownerName}</div>
                      <div><span className="font-semibold">Branch:</span> {branchName}</div>
                    </p>
                  </div>

                  {/* Complete Sale Button */}
                  <button
                    onClick={completeSale}
                    disabled={isProcessing}
                    className={`w-full font-bold py-4 px-6 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] text-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 bg-black hover:bg-gray-800 text-white`}
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Processing...</span>
                      </>
                    ) : (
                      `Complete Sale for ${branchName}`
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gradient-to-t from-gray-900/95 via-gray-900/90 to-gray-900/80 text-white/95 border-t border-white/10 backdrop-blur-2xl shadow-2xl mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="text-center text-sm text-gray-400">
            <p>{employeeName} selling for {ownerName} • {branchName}</p>
          </div>
        </div>
      </footer>

      {/* Global Styles */}
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

        .scrollbar-thin::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .scrollbar-thin::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 10px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb {
          background: #888;
          border-radius: 10px;
        }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
      `}</style>
    </div>
  );
}