"use client";

import { useEffect, useState, useRef } from "react";
import { db, auth } from "@/lib/firebase";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  serverTimestamp,
  getDoc,
} from "firebase/firestore";
import { useBranch } from "@/context/BranchContext";
import * as XLSX from "xlsx";
import Link from "next/link";
import Image from "next/image";

interface Product {
  id: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  minStock: number;
  purchaseRate: number;        // Current purchase rate
  originalPurchaseRate: number; // Original purchase rate (when first added)
  saleRate: number;            // Current sale rate
  originalSaleRate: number;    // Original sale rate (when first added)
  profit: number;
  allowSale: boolean;
  branchId: string;
  ownerId: string;
}

interface CurrencyOption {
  symbol: string;
  code: string;
  name: string;
  flag: string;
}

export default function Products() {
  const { activeBranch } = useBranch();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [ownerName, setOwnerName] = useState("");

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [qty, setQty] = useState("");
  const [minStock, setMinStock] = useState("");
  const [purchase, setPurchase] = useState("");
  const [sale, setSale] = useState("");
  const [allowSale, setAllowSale] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");
  
  // Currency state
  const [currency, setCurrency] = useState<CurrencyOption>({
    symbol: "$",
    code: "USD",
    name: "US Dollar",
    flag: "🇺🇸"
  });

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

  /* ---------------- LOAD USER DATA & CURRENCY ---------------- */
  useEffect(() => {
    const loadUserData = async () => {
      const user = auth.currentUser;
      if (!user) return;

      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setOwnerName(userData.name || "Owner");
          
          // Load user's saved currency preference
          if (userData.currency) {
            const savedCurrency = currencies.find(c => c.code === userData.currency);
            if (savedCurrency) {
              setCurrency(savedCurrency);
            }
          }
        }
      } catch (error) {
        console.error("Error loading user data:", error);
      }
    };

    loadUserData();
  }, []);

  /* ---------------- IMPORT PRODUCTS FROM EXCEL ---------------- */
  const handleImport = async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = async (event: any) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: "array" });

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(sheet);

      const user = auth.currentUser;
      if (!user || !activeBranch?.id) {
        alert("Select branch first");
        return;
      }

      for (const row of json) {
        const purchaseRate = Number(row.purchaseRate) || 0;
        const saleRate = Number(row.saleRate) || 0;

        await addDoc(collection(db, "products"), {
          name: row.name || "",
          category: row.category || "",
          unit: row.unit || "pcs",
          qty: Number(row.qty) || 0,
          minStock: Number(row.minStock) || 0,
          purchaseRate,
          originalPurchaseRate: purchaseRate, // Set original = current for new products
          saleRate,
          originalSaleRate: saleRate, // Set original = current for new products
          profit: saleRate - purchaseRate,
          allowSale: true,
          branchId: activeBranch.id,
          ownerId: user.uid,
          currency: currency.code,
          currencySymbol: currency.symbol,
          createdAt: serverTimestamp(),
        });
      }

      alert("Products Imported Successfully");
    };

    reader.readAsArrayBuffer(file);
  };

  /* ---------------- FETCH PRODUCTS ---------------- */
  useEffect(() => {
    if (!activeBranch?.id) return;

    const user = auth.currentUser;
    if (!user) return;

    const productsQuery = query(
      collection(db, "products"),
      where("ownerId", "==", user.uid),
      where("branchId", "==", activeBranch.id),
      orderBy("name", "asc")
    );

    const unsub = onSnapshot(productsQuery, (snap) => {
      const list: Product[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name,
          category: data.category,
          unit: data.unit,
          qty: data.qty,
          minStock: data.minStock,
          purchaseRate: data.purchaseRate,
          originalPurchaseRate: data.originalPurchaseRate || data.purchaseRate, // Fallback for existing products
          saleRate: data.saleRate,
          originalSaleRate: data.originalSaleRate || data.saleRate, // Fallback for existing products
          profit: data.profit,
          allowSale: data.allowSale,
          branchId: data.branchId,
          ownerId: data.ownerId,
        } as Product;
      });

      setProducts(list);
    });

    return () => unsub();
  }, [activeBranch?.id]);

  /* ---------------- RESET FORM ---------------- */
  const resetForm = () => {
    setSelectedProduct(null);
    setName("");
    setCategory("");
    setUnit("pcs");
    setQty("");
    setMinStock("");
    setPurchase("");
    setSale("");
    setAllowSale(true);
  };

  /* ---------------- SELECT PRODUCT ---------------- */
  const selectProduct = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return resetForm();

    setSelectedProduct(product);
    setName(product.name);
    setCategory(product.category);
    setUnit(product.unit);
    setQty(product.qty.toString());
    setMinStock(product.minStock.toString());
    setPurchase(product.purchaseRate.toString());
    setSale(product.saleRate.toString());
    setAllowSale(product.allowSale);
  };

  /* ---------------- ADD OR UPDATE PRODUCT ---------------- */
  const addOrUpdateProduct = async () => {
    const user = auth.currentUser;
    if (!user || !activeBranch?.id) return alert("Select branch first");

    const purchaseRate = Number(purchase);
    const saleRate = Number(sale);
    const profit = saleRate - purchaseRate;

    if (selectedProduct) {
      // UPDATE EXISTING PRODUCT - Keep original prices unchanged
      await updateDoc(doc(db, "products", selectedProduct.id), {
        name,
        category,
        unit,
        qty: Number(qty),
        minStock: Number(minStock),
        purchaseRate,
        saleRate,
        profit,
        allowSale,
        updatedAt: serverTimestamp(),
        // IMPORTANT: DO NOT update originalPurchaseRate and originalSaleRate
        // They remain as they were when product was first created
      });

      alert("Product Updated");
    } else {
      // ADD NEW PRODUCT - Set original prices equal to current prices
      await addDoc(collection(db, "products"), {
        name,
        category,
        unit,
        qty: Number(qty),
        minStock: Number(minStock),
        purchaseRate,
        originalPurchaseRate: purchaseRate, // Store original price for historical reference
        saleRate,
        originalSaleRate: saleRate, // Store original price for historical reference
        profit,
        allowSale,
        branchId: activeBranch.id,
        ownerId: user.uid,
        currency: currency.code,
        currencySymbol: currency.symbol,
        createdAt: serverTimestamp(),
      });

      alert("Product Added");
    }

    resetForm();
  };

  /* ---------------- DELETE PRODUCT ---------------- */
  const deleteProduct = async () => {
    if (!selectedProduct) return;

    await deleteDoc(doc(db, "products", selectedProduct.id));

    alert("Deleted");
    resetForm();
  };

  /* ---------------- SEARCH FILTER ---------------- */
  const filteredProducts = products.filter(
    (p) =>
      p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.category?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      
      {/* HEADER - Same as Dashboard */}
      <header className="bg-gradient-to-b from-gray-900 via-gray-900/95 to-gray-900/90 text-white shadow-2xl backdrop-blur-2xl border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between py-4 sm:py-5 gap-3">
            
            {/* Logo & Title */}
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
                <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent rounded-xl blur opacity-0 group-hover:opacity-100 transition-all duration-300"></div>
              </Link>
              <div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-200 bg-clip-text text-transparent">
                  Products
                </h1>
                <p className="text-sm text-gray-300">
                  {activeBranch?.shopName || "Select Branch"}
                </p>
              </div>
            </div>

            {/* Right Actions */}
            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              
              {/* Profile Avatar */}
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/20">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-bold text-white">
                  {getInitials(ownerName)}
                </div>
                <div className="text-sm">
                  <div className="font-semibold">{ownerName || "Owner"}</div>
                  <div className="text-xs text-gray-300">Owner</div>
                </div>
              </div>

              {/* Currency Display */}
              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/20">
                <span className="text-lg">{currency.flag}</span>
                <span className="font-bold">{currency.symbol}</span>
                <span className="text-xs text-gray-300">{currency.code}</span>
              </div>

              {/* Dashboard Link */}
              <Link 
                href="/owner-dashboard"
                className="flex items-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/30 hover:border-white/50 text-white font-semibold text-sm shadow-xl transition-all duration-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                <span>Dashboard</span>
              </Link>

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

      {/* MAIN CONTENT */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* SEARCH BAR */}
        <div className="mb-8">
          <div className="relative group max-w-2xl mx-auto">
            <input
              placeholder="Search products by name or category..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-14 pr-6 py-4 text-lg bg-white/90 backdrop-blur-xl border border-gray-200/60 hover:border-gray-300 focus:ring-4 focus:ring-gray-200/50 focus:border-gray-400 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 outline-none placeholder-gray-500 font-medium"
            />
            <div className="absolute left-5 top-1/2 -translate-y-1/2 text-2xl text-gray-400">
              🔍
            </div>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* LEFT COLUMN - Product List & Import */}
          <div className="space-y-6">
            
            {/* Product List Card */}
            <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/60 p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl flex items-center justify-center shadow-lg">
                    <span className="text-xl">📋</span>
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">Product List</h2>
                </div>
                <span className="bg-gray-900 text-white px-3 py-1 rounded-full text-sm font-semibold">
                  {filteredProducts.length} items
                </span>
              </div>

              {/* Product Selector */}
              <select
                value={selectedProduct?.id || ""}
                onChange={(e) => selectProduct(e.target.value)}
                className="w-full px-4 py-3 mb-4 bg-white border border-gray-200 hover:border-gray-300 focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900 rounded-xl transition-all duration-300 outline-none font-medium text-gray-900"
              >
                <option value="" className="text-gray-500">
                  ➕ Create New Product
                </option>
                {filteredProducts.map((p) => (
                  <option key={p.id} value={p.id} className="font-medium">
                    {p.name} ({p.qty} {p.unit})
                  </option>
                ))}
              </select>

              {/* Product List Preview */}
              <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                {filteredProducts.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-4xl mb-3">📦</div>
                    <p className="text-gray-400 font-medium">No products found</p>
                  </div>
                ) : (
                  filteredProducts.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => selectProduct(p.id)}
                      className={`p-3 rounded-xl border transition-all duration-300 cursor-pointer ${
                        selectedProduct?.id === p.id
                          ? 'bg-gray-900 text-white border-gray-900 shadow-lg'
                          : 'bg-gray-50 hover:bg-white border-gray-200 hover:border-gray-300 text-gray-900'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold">{p.name}</div>
                          <div className={`text-xs mt-1 ${selectedProduct?.id === p.id ? 'text-gray-300' : 'text-gray-500'}`}>
                            {p.category} • {p.unit}
                          </div>
                          {/* Optional: Show original price in tooltip style */}
                          {p.originalSaleRate !== p.saleRate && (
                            <div className={`text-xs mt-1 ${selectedProduct?.id === p.id ? 'text-gray-400' : 'text-gray-400'}`}>
                              Original: {currency.symbol}{formatCurrency(p.originalSaleRate)}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{currency.symbol}{formatCurrency(p.saleRate)}</div>
                          <div className={`text-xs mt-1 ${selectedProduct?.id === p.id ? 'text-gray-300' : 'text-gray-500'}`}>
                            Stock: {p.qty}
                          </div>
                        </div>
                      </div>
                      {p.minStock > 0 && p.qty <= p.minStock && (
                        <div className={`mt-2 text-xs font-semibold px-2 py-1 rounded-full inline-block ${
                          selectedProduct?.id === p.id 
                            ? 'bg-red-400 text-white' 
                            : 'bg-red-100 text-red-600'
                        }`}>
                          ⚠️ Low Stock
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Import Excel Card */}
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 backdrop-blur-xl rounded-2xl shadow-xl border border-emerald-200/60 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center shadow-lg">
                  <span className="text-xl text-white">📊</span>
                </div>
                <h2 className="text-xl font-bold text-gray-900">Import from Excel</h2>
              </div>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <span className="text-xl">📁</span>
                Upload Excel File
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleImport}
                className="hidden"
              />

              <div className="mt-4 p-3 bg-white/60 backdrop-blur-sm rounded-xl border border-emerald-200/50">
                <p className="text-xs text-gray-600 font-medium">
                  Required columns: <span className="font-mono text-emerald-600">name, category, unit, qty, minStock, purchaseRate, saleRate</span>
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN - Product Form */}
          <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/60 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg">
                <span className="text-xl text-white">✏️</span>
              </div>
              <h2 className="text-xl font-bold text-gray-900">
                {selectedProduct ? "Edit Product" : "New Product"}
              </h2>
            </div>

            <div className="space-y-4">
              {/* Product Name */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Product Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none transition-all duration-300 text-gray-900"
                  placeholder="Enter product name"
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Category
                </label>
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none transition-all duration-300 text-gray-900"
                  placeholder="Enter category"
                />
              </div>

              {/* Unit */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Unit
                </label>
<select
  value={unit}
  onChange={(e) => setUnit(e.target.value)}
  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none transition-all duration-300 text-gray-900"
>
  <option value="pcs">Pieces (pcs)</option>
  <option value="box">Box (box)</option>
  <option value="carton">Carton (ctn)</option>
  <option value="pack">Pack (pack)</option>
  <option value="kg">Kilogram (kg)</option>
  <option value="g">Gram (g)</option>
  <option value="liter">Liter (L)</option>
  <option value="ml">Milliliter (ml)</option>
</select>
              </div>

              {/* Quantity and Min Stock */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none transition-all duration-300 text-gray-900"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Min Stock
                  </label>
                  <input
                    type="number"
                    value={minStock}
                    onChange={(e) => setMinStock(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none transition-all duration-300 text-gray-900"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Purchase and Sale Rate */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Purchase Rate ({currency.symbol})
                  </label>
                  <input
                    type="number"
                    value={purchase}
                    onChange={(e) => setPurchase(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none transition-all duration-300 text-gray-900"
                    placeholder="0"
                  />
                  {selectedProduct && selectedProduct.originalPurchaseRate !== Number(purchase) && (
                    <p className="text-xs text-gray-500 mt-1">
                      Original: {currency.symbol}{formatCurrency(selectedProduct.originalPurchaseRate)}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Sale Rate ({currency.symbol})
                  </label>
                  <input
                    type="number"
                    value={sale}
                    onChange={(e) => setSale(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none transition-all duration-300 text-gray-900"
                    placeholder="0"
                  />
                  {selectedProduct && selectedProduct.originalSaleRate !== Number(sale) && (
                    <p className="text-xs text-gray-500 mt-1">
                      Original: {currency.symbol}{formatCurrency(selectedProduct.originalSaleRate)}
                    </p>
                  )}
                </div>
              </div>

              {/* Profit Preview */}
              {purchase && sale && (
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-gray-700">Profit per unit:</span>
                    <span className="text-lg font-bold text-green-600">
                      {currency.symbol}{formatCurrency(Number(sale) - Number(purchase))}
                    </span>
                  </div>
                  {selectedProduct && selectedProduct.originalSaleRate && (
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-xs text-gray-500">Original profit:</span>
                      <span className="text-xs text-gray-600">
                        {currency.symbol}{formatCurrency(selectedProduct.originalSaleRate - selectedProduct.originalPurchaseRate)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Allow Sale Toggle */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="allowSale"
                  checked={allowSale}
                  onChange={(e) => setAllowSale(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                />
                <label htmlFor="allowSale" className="text-sm font-semibold text-gray-700">
                  Allow this product to be sold
                </label>
              </div>

              {/* Info Note about Price Changes */}
              {selectedProduct && (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
                  <p className="text-xs text-blue-700">
                    💡 <strong>Note:</strong> Changing prices will only affect future sales. 
                    Previous sales will keep their original prices for accurate records.
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2 pt-4">
                <button
                  onClick={addOrUpdateProduct}
                  className="w-full bg-gradient-to-r from-gray-900 to-gray-800 hover:from-gray-800 hover:to-gray-700 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <span className="text-xl">{selectedProduct ? "✏️" : "➕"}</span>
                  {selectedProduct ? "Update Product" : "Add Product"}
                </button>

                {selectedProduct && (
                  <button
                    onClick={deleteProduct}
                    className="w-full bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <span className="text-xl">🗑️</span>
                    Delete Product
                  </button>
                )}

                {selectedProduct && (
                  <button
                    onClick={resetForm}
                    className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 px-6 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <span className="text-xl">🔄</span>
                    Cancel Edit
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="bg-gradient-to-t from-gray-900/95 via-gray-900/90 to-gray-900/80 text-white/95 border-t border-white/10 backdrop-blur-2xl shadow-2xl mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center">
            <p className="text-lg text-gray-400/90 font-semibold tracking-wide">
              Manage your inventory with precision
            </p>
            <div className="flex items-center justify-center gap-4 mt-4">
              <span className="text-sm text-gray-500">
                © {new Date().getFullYear()} Stockaroo
              </span>
              <span className="text-gray-600">•</span>
              <span className="text-sm text-gray-500">
                Active Branch: {activeBranch?.shopName || "Not Selected"}
              </span>
              <span className="text-gray-600">•</span>
              <span className="text-sm text-gray-500 flex items-center gap-1">
                <span>{currency.flag}</span>
                {currency.code} ({currency.symbol})
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* Global Styles */}
      <style jsx global>{`
        /* Custom Scrollbar */
        .overflow-y-auto::-webkit-scrollbar {
          width: 6px;
        }
        .overflow-y-auto::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-radius: 10px;
        }
        .overflow-y-auto::-webkit-scrollbar-thumb {
          background: #888;
          border-radius: 10px;
        }
        .overflow-y-auto::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
        
        /* Smooth scroll */
        html {
          scroll-behavior: smooth;
        }
      `}</style>
    </div>
  );
}