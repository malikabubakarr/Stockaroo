"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
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
  limit
} from "firebase/firestore";
import Image from "next/image";
import Link from "next/link";

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

  // Show toast notification
  const showNotification = useCallback((title: string, message: string, type: "success" | "error" | "info" = "success") => {
    setToastMessage({ title, message, type });
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  }, []);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

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
              
              await addDoc(collection(db, "sales"), saleData);
            } catch (err) {
              if (DEBUG) console.error("Error syncing offline sale:", err);
            }
          }

          localStorage.removeItem("employee_offline_sales");
          showNotification("Sync Complete", "All offline sales have been synced", "success");
          
          // Refresh products after sync
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

  // Load products function (reusable)
  const loadProducts = useCallback(async () => {
    if (!branchId) return;
    
    try {
      const prodQuery = query(
        collection(db, "products"),
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
      })) as Product[];

      setProducts(list);
      
      // Cache products
      localStorage.setItem("employee_products_cache", JSON.stringify(list));
    } catch (error) {
      if (DEBUG) console.error("Error loading products:", error);
    }
  }, [branchId]);

  // Detect employee login with cache
  useEffect(() => {
    // Load products from cache instantly
    const cachedProducts = localStorage.getItem("employee_products_cache");
    if (cachedProducts) {
      try {
        setProducts(JSON.parse(cachedProducts));
      } catch (e) {
        if (DEBUG) console.error("Error parsing products cache:", e);
      }
    }

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;

      const uid = user.uid;

      try {
        // Find employee document
        const q = query(
          collection(db, "employees"),
          where("uid", "==", uid),
          limit(1)
        );

        const snap = await getDocs(q);

        if (!snap.empty) {
          const emp = snap.docs[0].data();
          
          setEmployeeData(emp);
          setEmployeeName(emp.name);
          setEmployeeId(uid);
          setBranchId(emp.branchId);
          setBranchName(emp.branchName);
          setOwnerName(emp.ownerName || "");
          setOwnerId(emp.ownerId || "");
          
          // Load products
          await loadProducts();
        }
      } catch (error) {
        if (DEBUG) console.error("Error loading employee data:", error);
      } finally {
        setIsLoading(false);
      }
    });

    return () => unsub();
  }, [loadProducts]);

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

  // Add product to cart (memoized)
  const addToCart = useCallback((product: Product) => {
    if (product.qty <= 0) {
      showNotification("Out of Stock", "Product is out of stock", "error");
      return;
    }

    setCart(prev => {
      const exist = prev.find(p => p.id === product.id);

      if (exist) {
        if (exist.qty >= product.qty) {
          showNotification("Stock Limit", `Maximum available stock: ${product.qty}`, "error");
          return prev;
        }
        showNotification("Cart Updated", `${product.name} quantity increased`, "success");
        return prev.map(p =>
          p.id === product.id ? { ...p, qty: p.qty + 1 } : p
        );
      } else {
        showNotification("Item Added", `${product.name} added to cart`, "success");
        return [...prev, { 
          id: product.id, 
          name: product.name, 
          price: product.saleRate, 
          qty: 1,
          unit: product.unit,
          profit: product.profit,
          purchaseRate: product.purchaseRate
        }];
      }
    });
  }, [showNotification]);

  // Update cart quantity (memoized)
  const updateCartQty = useCallback((productId: string, newQty: number) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    if (newQty <= 0) {
      removeFromCart(productId);
      return;
    }

    if (newQty > product.qty) {
      showNotification("Stock Limit", `Maximum available stock: ${product.qty}`, "error");
      return;
    }

    setCart(prev =>
      prev.map(item =>
        item.id === productId ? { ...item, qty: newQty } : item
      )
    );
  }, [products, showNotification]);

  // Remove from cart (memoized)
  const removeFromCart = useCallback((productId: string) => {
    const item = cart.find(c => c.id === productId);
    if (item) {
      showNotification("Item Removed", `${item.name} removed from cart`, "info");
    }
    setCart(prev => prev.filter(item => item.id !== productId));
  }, [cart, showNotification]);

  // Calculate totals with discount (memoized) - REMOVED PROFIT
  const totals = useMemo(() => {
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
    
    // Calculate discount amount
    let discountAmount = 0;
    if (discountType === "flat") {
      discountAmount = Math.min(discount, subtotal);
    } else {
      discountAmount = (subtotal * discount) / 100;
    }
    
    // Ensure discount doesn't exceed subtotal
    discountAmount = Math.min(discountAmount, subtotal);
    
    // Calculate final amount
    const totalAmount = subtotal - discountAmount;

    return { 
      subtotal, 
      discountAmount, 
      totalAmount
    };
  }, [cart, discount, discountType]);

  // Complete sale with offline support and spinner
  const completeSale = useCallback(async () => {
    if (cart.length === 0) {
      showNotification("Empty Cart", "Please add items to cart first", "error");
      return;
    }

    setIsProcessing(true);

    try {
      // Check stock availability again
      for (const item of cart) {
        const product = products.find(p => p.id === item.id);
        if (!product || product.qty < item.qty) {
          showNotification("Stock Error", `Insufficient stock for ${item.name}`, "error");
          setIsProcessing(false);
          return;
        }
      }

      // Calculate total profit for database (hidden from UI)
      const totalProfit = cart.reduce((sum, item) => sum + item.profit * item.qty, 0);
      let discountAmount = 0;
      if (discountType === "flat") {
        discountAmount = Math.min(discount, totals.subtotal);
      } else {
        discountAmount = (totals.subtotal * discount) / 100;
      }
      discountAmount = Math.min(discountAmount, totals.subtotal);
      const finalProfit = totalProfit - discountAmount;

      // If offline, save to localStorage
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

        showNotification("Saved Offline", "Sale saved. Will sync when online.", "info");
        
        // Clear cart and reset discount
        setCart([]);
        setDiscount(0);
        setDiscountType("flat");
        setIsProcessing(false);
        return;
      }

      // Online - use batch write for atomic operation
      const batch = writeBatch(db);

      // Update product quantities using increment
      for (const item of cart) {
        const productRef = doc(db, "products", item.id);
        batch.update(productRef, {
          qty: increment(-item.qty)
        });
      }

      // Record sale
      const saleRef = doc(collection(db, "sales"));
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
          profit: item.profit,
          purchaseRate: item.purchaseRate,
          total: item.price * item.qty,
          itemProfit: item.profit * item.qty
        })),
        totalAmount: totals.totalAmount,
        totalProfit: finalProfit,
        discount: discountAmount,
        discountType,
        type: "employee_sale",
        date: serverTimestamp(),
        createdAt: serverTimestamp()
      });

      // Commit all writes atomically
      await batch.commit();

      showNotification("Sale Completed!", `Total: ₨${formatCurrency(totals.totalAmount)}`, "success");

      // Clear cart and reset discount
      setCart([]);
      setDiscount(0);
      setDiscountType("flat");

      // Refresh products to show updated stock
      await loadProducts();

    } catch (error) {
      if (DEBUG) console.error("Error completing sale:", error);
      showNotification("Error", "Failed to complete sale", "error");
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
                  className="w-10 h-10 sm:w-11 sm:h-11 object-contain rounded-xl shadow-lg group-hover:scale-110 transition-all duration-300"
                  priority
                />
              </Link>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-200 bg-clip-text text-transparent">
                  Employee Sales
                </h1>
                <p className="text-sm text-gray-300">
                  {branchName || "Loading..."}
                </p>
              </div>
            </div>

            {/* Employee Info */}
            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/20">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-bold text-white">
                  {getInitials(employeeName)}
                </div>
                <div className="text-sm">
                  <div className="font-semibold">{employeeName || "Employee"}</div>
                  <div className="text-xs text-gray-300">Selling for {ownerName}</div>
                </div>
              </div>

              {/* Offline Badge */}
              {isOffline && (
                <div className="bg-white/10 backdrop-blur-xl border border-white/30 text-white/90 text-sm px-4 py-2 rounded-xl font-semibold shadow-xl animate-pulse">
                  📴 Offline
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
              {/* Search */}
              <div className="relative group mb-4">
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-white/90 backdrop-blur-xl border border-gray-200/60 hover:border-gray-300 focus:ring-4 focus:ring-gray-200/50 focus:border-gray-400 rounded-xl transition-all duration-300 outline-none placeholder-gray-500"
                />
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-xl text-gray-400">
                  🔍
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
                      {cat === "all" ? "All" : cat}
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
                  </div>
                ) : (
                  filteredProducts.map(product => (
                    <button
                      key={product.id}
                      onClick={() => addToCart(product)}
                      disabled={product.qty === 0 || isProcessing}
                      className={`p-4 rounded-xl border transition-all duration-300 text-left ${
                        product.qty === 0 || isProcessing
                          ? 'bg-gray-100 border-gray-200 cursor-not-allowed opacity-50'
                          : 'bg-white hover:bg-gray-50 border-gray-200 hover:border-gray-900 hover:shadow-lg'
                      }`}
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
                          ⚠️ Only {product.qty} left
                        </div>
                      )}
                    </button>
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
                    {cart.length} items
                  </span>
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
                      <option value="percent">%</option>
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
                    <p className="text-xs text-gray-400 mt-2">Click products to add</p>
                  </div>
                ) : (
                  cart.map(item => (
                    <div key={item.id} className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="font-semibold text-gray-900">{item.name}</div>
                          <div className="text-xs text-gray-500">For {ownerName}'s store</div>
                        </div>
                        <button
                          onClick={() => removeFromCart(item.id)}
                          disabled={isProcessing}
                          className="text-red-500 hover:text-red-700 disabled:opacity-50"
                        >
                          ✕
                        </button>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateCartQty(item.id, item.qty - 1)}
                            disabled={isProcessing}
                            className="w-8 h-8 bg-gray-200 rounded-lg hover:bg-gray-300 flex items-center justify-center font-bold disabled:opacity-50"
                          >
                            -
                          </button>
                          <span className="font-semibold w-8 text-center">{item.qty}</span>
                          <button
                            onClick={() => updateCartQty(item.id, item.qty + 1)}
                            disabled={isProcessing}
                            className="w-8 h-8 bg-gray-200 rounded-lg hover:bg-gray-300 flex items-center justify-center font-bold disabled:opacity-50"
                          >
                            +
                          </button>
                          <span className="text-xs text-gray-500 ml-2">{item.unit}</span>
                        </div>
                        <span className="font-bold text-gray-900">
                          ₨{formatCurrency(item.price * item.qty)}
                        </span>
                      </div>
                    </div>
                  ))
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
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-gray-600 font-semibold">Total Amount:</span>
                    <span className="text-2xl font-bold text-gray-900">
                      ₨{formatCurrency(totals.totalAmount)}
                    </span>
                  </div>

                  {/* Info Box */}
                  <div className="bg-blue-50 p-3 rounded-xl mb-4">
                    <p className="text-xs text-blue-800">
                      <span className="font-semibold">Employee:</span> {employeeName}<br />
                      <span className="font-semibold">Owner:</span> {ownerName}<br />
                      <span className="font-semibold">Branch:</span> {branchName}
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