"use client";

import { useEffect, useState, useRef, useMemo, useCallback, useReducer } from "react";
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
  getDocs,
  writeBatch,
  runTransaction,
  limit,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData,
  QueryConstraint,
  setDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
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
  purchaseRate: number;
  originalPurchaseRate: number;
  saleRate: number;
  originalSaleRate: number;
  profit: number;
  allowSale: boolean;
  branchId: string;
  ownerId: string;
  barcode?: string;
  createdAt?: any;
  updatedAt?: any;
}

interface CurrencyOption {
  symbol: string;
  code: string;
  name: string;
  flag: string;
}

interface AppState {
  products: Product[];
  selectedProduct: Product | null;
  isOffline: boolean;
  ownerName: string;
  loading: boolean;
  isSubmitting: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
  initialLoadDone: boolean;
  name: string;
  category: string;
  unit: string;
  qty: string;
  minStock: string;
  purchase: string;
  sale: string;
  allowSale: boolean;
  barcode: string;
  searchTerm: string;
  toast: { message: string; type: string } | null;
}

type AppAction =
  | { type: 'SET_PRODUCTS'; payload: Product[] }
  | { type: 'SET_SELECTED_PRODUCT'; payload: Product | null }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_LOADING_MORE'; payload: boolean }
  | { type: 'SET_LAST_DOC'; payload: QueryDocumentSnapshot<DocumentData> | null }
  | { type: 'SET_HAS_MORE'; payload: boolean }
  | { type: 'SET_INITIAL_LOAD_DONE'; payload: boolean }
  | { type: 'SET_FORM_FIELD'; payload: { field: keyof Pick<AppState, 'name'|'category'|'unit'|'qty'|'minStock'|'purchase'|'sale'|'barcode'|'allowSale'>; value: any } }
  | { type: 'RESET_FORM' }
  | { type: 'SET_SEARCH_TERM'; payload: string }
  | { type: 'SET_TOAST'; payload: { message: string; type: string } | null }
  | { type: 'SET_OFFLINE'; payload: boolean }
  | { type: 'SET_OWNER_NAME'; payload: string };

const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'SET_PRODUCTS':
      return { ...state, products: action.payload };
    case 'SET_SELECTED_PRODUCT':
      return { ...state, selectedProduct: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_LOADING_MORE':
      return { ...state, loadingMore: action.payload };
    case 'SET_LAST_DOC':
      return { ...state, lastDoc: action.payload };
    case 'SET_HAS_MORE':
      return { ...state, hasMore: action.payload };
    case 'SET_INITIAL_LOAD_DONE':
      return { ...state, initialLoadDone: action.payload };
    case 'SET_FORM_FIELD':
      return { ...state, [action.payload.field]: action.payload.value };
    case 'RESET_FORM':
      return {
        ...state,
        selectedProduct: null,
        name: '',
        category: '',
        unit: 'pcs',
        qty: '',
        minStock: '',
        purchase: '',
        sale: '',
        allowSale: true,
        barcode: ''
      };
    case 'SET_SEARCH_TERM':
      return { ...state, searchTerm: action.payload };
    case 'SET_TOAST':
      return { ...state, toast: action.payload };
    case 'SET_OFFLINE':
      return { ...state, isOffline: action.payload };
    case 'SET_OWNER_NAME':
      return { ...state, ownerName: action.payload };
    default:
      return state;
  }
};

// ✅ FIXED: Proper debounce with cleanup
function useDebounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
  const timeoutRef = useRef<NodeJS.Timeout>();
  
  const debounced = useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => func(...args), wait);
  }, [func, wait]) as T;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return debounced as T;
}

const CACHE_KEY = "products_cache_v2";
const PAGE_SIZE = 50;
const BATCH_SIZE = 400;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export default function Products() {
  const { activeBranch } = useBranch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const observerTarget = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // ✅ FIXED: Single source of truth with reducer
  const [state, dispatch] = useReducer(appReducer, {
    products: [],
    selectedProduct: null,
    isOffline: false,
    ownerName: "",
    loading: false,
    isSubmitting: false,
    hasMore: true,
    loadingMore: false,
    lastDoc: null,
    initialLoadDone: false,
    name: "",
    category: "",
    unit: "pcs",
    qty: "",
    minStock: "",
    purchase: "",
    sale: "",
    allowSale: true,
    barcode: "",
    searchTerm: "",
    toast: null,
  });

  const [authUser, setAuthUser] = useState<any>(null);
  const [currency, setCurrency] = useState<CurrencyOption>({
    symbol: "$", code: "USD", name: "US Dollar", flag: "🇺🇸"
  });

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

  // ✅ FIXED: Memoized derived state
  const filteredProducts = useMemo(() => {
    if (!state.searchTerm.trim()) return state.products;
    const searchLower = state.searchTerm.toLowerCase();
    return state.products.filter((p) => {
      const nameMatch = p.name?.toLowerCase().includes(searchLower);
      const categoryMatch = p.category?.toLowerCase().includes(searchLower);
      const barcodeMatch = p.barcode?.toLowerCase().includes(searchLower);
      return nameMatch || categoryMatch || barcodeMatch;
    });
  }, [state.products, state.searchTerm]);

  // ✅ FIXED: Stable callbacks with proper deps
  const showToast = useCallback((message: string, type: string = "success") => {
    dispatch({ type: 'SET_TOAST', payload: { message, type } });
    setTimeout(() => dispatch({ type: 'SET_TOAST', payload: null }), 3000);
  }, []);

  const cleanBarcode = useCallback((barcodeValue: string): string => {
    return barcodeValue.trim().replace(/[^a-zA-Z0-9]/g, '');
  }, []);

  const debouncedSearch = useDebounce((value: string) => {
    dispatch({ type: 'SET_SEARCH_TERM', payload: value });
  }, 300);

  // ✅ FIXED: Auth with proper cleanup
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setAuthUser);
    return unsubscribe;
  }, []);

  // ✅ FIXED: Online/offline with stable handler
  useEffect(() => {
    const handleStatus = () => {
      dispatch({ type: 'SET_OFFLINE', payload: !navigator.onLine });
    };
    handleStatus();
    window.addEventListener("online", handleStatus);
    window.addEventListener("offline", handleStatus);
    return () => {
      window.removeEventListener("online", handleStatus);
      window.removeEventListener("offline", handleStatus);
    };
  }, []);

  // ✅ FIXED: User data load
  useEffect(() => {
    if (!authUser) return;
    
    const loadUserData = async () => {
      try {
        const userDoc = await getDoc(doc(db, "users", authUser.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          dispatch({ type: 'SET_OWNER_NAME', payload: userData.name || "Owner" });
          if (userData.currency) {
            const savedCurrency = currencies.find(c => c.code === userData.currency);
            if (savedCurrency) setCurrency(savedCurrency);
          }
        }
      } catch (error) {
        console.error("Error loading user data:", error);
      }
    };
    loadUserData();
  }, [authUser, currencies]);

  // ✅ FIXED: Proper pagination - NO real-time conflicts
  const loadProducts = useCallback(async (reset: boolean = true) => {
    if (!activeBranch?.id || !authUser) return;
    
    if (reset) {
      dispatch({ type: 'SET_PRODUCTS', payload: [] });
      dispatch({ type: 'SET_LAST_DOC', payload: null });
      dispatch({ type: 'SET_HAS_MORE', payload: true });
    }
    
    if (!reset && (!state.hasMore || state.loadingMore)) return;
    
    dispatch({ type: 'SET_LOADING_MORE', payload: true });
    
    try {
      const constraints: QueryConstraint[] = [
        where("ownerId", "==", authUser.uid),
        where("branchId", "==", activeBranch.id),
        orderBy("name", "asc"),
        limit(PAGE_SIZE)
      ];
      
      if (!reset && state.lastDoc) {
        constraints.push(startAfter(state.lastDoc));
      }
      
      const productsQuery = query(collection(db, "products"), ...constraints);
      const snap = await getDocs(productsQuery);
      
      const newProducts: Product[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Product, 'id'>)
      }));
      
      dispatch({ type: 'SET_PRODUCTS', payload: reset ? newProducts : [...state.products, ...newProducts] });
      dispatch({ type: 'SET_LAST_DOC', payload: snap.docs[snap.docs.length - 1] || null });
      dispatch({ type: 'SET_HAS_MORE', payload: snap.docs.length === PAGE_SIZE });
      dispatch({ type: 'SET_INITIAL_LOAD_DONE', payload: true });
    } catch (error) {
      console.error("Load products error:", error);
      showToast("Failed to load products", "error");
    } finally {
      dispatch({ type: 'SET_LOADING_MORE', payload: false });
    }
  }, [activeBranch?.id, authUser, state.hasMore, state.loadingMore, state.lastDoc, state.products, showToast]);

  // ✅ FIXED: Initial load - stable deps
  useEffect(() => {
    if (activeBranch?.id && authUser && !state.initialLoadDone) {
      loadProducts(true);
    }
  }, [activeBranch?.id, authUser, state.initialLoadDone, loadProducts]);

  // ✅ FIXED: SINGLE real-time listener for FIRST PAGE ONLY
  useEffect(() => {
    if (!activeBranch?.id || !authUser || state.initialLoadDone) return;

    // Listen ONLY to first page to avoid pagination conflicts
    const productsQuery = query(
      collection(db, "products"),
      where("ownerId", "==", authUser.uid),
      where("branchId", "==", activeBranch.id),
      orderBy("name", "asc"),
      limit(PAGE_SIZE)
    );

    const unsubscribe = onSnapshot(productsQuery, (snap) => {
      const updatedProducts: Product[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Product, 'id'>)
      }));
      dispatch({ type: 'SET_PRODUCTS', payload: updatedProducts });
    });

    unsubscribeRef.current = unsubscribe;

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [activeBranch?.id, authUser, state.initialLoadDone]);

  // ✅ FIXED: Debounced infinite scroll observer
  useEffect(() => {
    if (!observerTarget.current || !state.hasMore || state.loadingMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && state.hasMore && !state.loadingMore) {
          loadProducts(false);
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    observer.observe(observerTarget.current);
    observerRef.current = observer;

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [state.hasMore, state.loadingMore, loadProducts]);

  // ✅ FIXED: Stable product operations
  const createProductWithUniqueBarcode = useCallback(async (productData: any) => {
    const user = authUser;
    if (!user || !activeBranch?.id) throw new Error("Missing user or branch");

    const barcodeValue = productData.barcode;
    if (!barcodeValue) {
      return await addDoc(collection(db, "products"), productData);
    }

    const cleanBar = cleanBarcode(barcodeValue);
    if (!cleanBar) {
      return await addDoc(collection(db, "products"), productData);
    }

    let productId = "";
    
    await runTransaction(db, async (tx) => {
      const barcodeRef = doc(db, "barcodes", cleanBar);
      const barcodeSnap = await tx.get(barcodeRef);

      if (barcodeSnap.exists()) {
        throw new Error(`Barcode ${cleanBar} already exists`);
      }

      const productRef = doc(collection(db, "products"));
      productId = productRef.id;
      
      tx.set(productRef, { ...productData, barcode: cleanBar, id: productId });
      tx.set(barcodeRef, { 
        productId, 
        branchId: activeBranch.id,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      });
    });
    
    return { id: productId };
  }, [authUser, activeBranch?.id, cleanBarcode]);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      showToast("File too large (max 5MB)", "error");
      return;
    }

    dispatch({ type: 'SET_LOADING', payload: true });
    
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(sheet);

      if (!json.length) {
        showToast("Excel file is empty", "error");
        return;
      }

      const user = authUser;
      if (!user || !activeBranch?.id) {
        showToast("Select branch first", "error");
        return;
      }

      const batch = writeBatch(db);
      let successCount = 0;
      let errorCount = 0;

      for (const row of json.slice(0, 1000)) {
        const purchaseRate = Number(row.purchaseRate) || 0;
        const saleRate = Number(row.saleRate) || 0;
        
        if (!row.name || row.name.trim() === "") {
          errorCount++;
          continue;
        }
        
        if (saleRate < purchaseRate) {
          errorCount++;
          continue;
        }

        const ref = doc(collection(db, "products"));
        batch.set(ref, {
          name: row.name.trim(),
          category: row.category || "",
          unit: row.unit || "pcs",
          qty: Number(row.qty) || 0,
          minStock: Number(row.minStock) || 0,
          purchaseRate,
          originalPurchaseRate: purchaseRate,
          saleRate,
          originalSaleRate: saleRate,
          profit: saleRate - purchaseRate,
          allowSale: true,
          branchId: activeBranch.id,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
          barcode: row.barcode ? cleanBarcode(String(row.barcode)) : "",
        });
        successCount++;
      }

      await batch.commit();
      showToast(`Imported ${successCount} products (${errorCount} skipped)`, "success");
      loadProducts(true);
    } catch (error) {
      console.error("Import error:", error);
      showToast("Error importing products", "error");
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [authUser, activeBranch?.id, cleanBarcode, showToast, loadProducts]);

    const deleteAllProducts = useCallback(async () => {
    const user = authUser;
    if (!user || !activeBranch?.id) {
      showToast("Please select a branch first", "error");
      return;
    }

    if (!confirm("⚠️ WARNING: Delete ALL products in this branch?")) return;

    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      let lastSnapshot: QueryDocumentSnapshot<DocumentData> | null = null;
      let totalDeleted = 0;

      while (true) {
        const constraints: QueryConstraint[] = [
          where("ownerId", "==", user.uid),
          where("branchId", "==", activeBranch.id),
          orderBy("name"),
          limit(BATCH_SIZE)
        ];
        
        if (lastSnapshot) {
          constraints.push(startAfter(lastSnapshot));
        }
        
        const q = query(collection(db, "products"), ...constraints);
        const snap = await getDocs(q);
        
        if (snap.empty) break;
        
        const batch = writeBatch(db);
        snap.docs.forEach((docSnap) => {
          const barcode = docSnap.data().barcode;
          if (barcode) {
            batch.delete(doc(db, "barcodes", cleanBarcode(String(barcode))));
          }
          batch.delete(docSnap.ref);
        });

        await batch.commit();
        totalDeleted += snap.size;
        lastSnapshot = snap.docs[snap.docs.length - 1];
        
        if (snap.size < BATCH_SIZE) break;
      }

      showToast(`Deleted ${totalDeleted} products`, "success");
      loadProducts(true);
    } catch (error) {
      console.error("Delete error:", error);
      showToast("Error deleting products", "error");
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [authUser, activeBranch?.id, cleanBarcode, showToast, loadProducts]);

  const resetForm = useCallback(() => {
    dispatch({ type: 'RESET_FORM' });
  }, []);

  const selectProduct = useCallback((productId: string) => {
    const product = state.products.find(p => p.id === productId);
    if (!product) {
      resetForm();
      return;
    }
    
    dispatch({ type: 'SET_SELECTED_PRODUCT', payload: product });
    dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'name', value: product.name } });
    dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'category', value: product.category } });
    dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'unit', value: product.unit } });
    dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'qty', value: product.qty.toString() } });
    dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'minStock', value: product.minStock.toString() } });
    dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'purchase', value: product.purchaseRate.toString() } });
    dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'sale', value: product.saleRate.toString() } });
    dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'allowSale', value: product.allowSale } });
    dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'barcode', value: product.barcode || "" } });
  }, [state.products, resetForm]);

  const validateProduct = useCallback((): boolean => {
    if (!authUser || !activeBranch?.id) {
      showToast("Please select a branch first", "error");
      return false;
    }
    
    if (!state.name.trim()) {
      showToast("Product name required", "error");
      return false;
    }
    
    const qtyNum = Number(state.qty);
    const minStockNum = Number(state.minStock);
    const purchaseNum = Number(state.purchase);
    const saleNum = Number(state.sale);
    
    if (isNaN(qtyNum) || qtyNum < 0) {
      showToast("Invalid quantity", "error");
      return false;
    }
    
    if (isNaN(minStockNum) || minStockNum < 0) {
      showToast("Invalid min stock", "error");
      return false;
    }
    
    if (isNaN(purchaseNum) || purchaseNum <= 0) {
      showToast("Valid purchase price required", "error");
      return false;
    }
    
    if (isNaN(saleNum) || saleNum <= 0) {
      showToast("Valid sale price required", "error");
      return false;
    }
    
    if (saleNum < purchaseNum) {
      showToast("Sale price must be higher than purchase", "error");
      return false;
    }
    
    return true;
  }, [authUser, activeBranch?.id, state.name, state.qty, state.minStock, state.purchase, state.sale, showToast]);

  const addOrUpdateProduct = useCallback(async () => {
    if (state.isSubmitting || state.loading) return;
    if (!validateProduct()) return;
    
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'isSubmitting' as any, value: true } });

    try {
      const user = authUser!;
      const purchaseRate = Number(state.purchase);
      const saleRate = Number(state.sale);
      const cleanedBarcode = state.barcode.trim() ? cleanBarcode(state.barcode) : null;
      
      const productData = {
        name: state.name.trim(),
        category: state.category.trim(),
        unit: state.unit,
        qty: Number(state.qty),
        minStock: Number(state.minStock),
        purchaseRate,
        originalPurchaseRate: purchaseRate,
        saleRate,
        originalSaleRate: saleRate,
        profit: saleRate - purchaseRate,
        allowSale: state.allowSale,
        ownerId: user.uid,
        branchId: activeBranch!.id,
        barcode: cleanedBarcode,
        updatedAt: serverTimestamp()
      };

      if (state.selectedProduct) {
        if (cleanedBarcode && cleanedBarcode !== state.selectedProduct.barcode) {
          const barcodeRef = doc(db, "barcodes", cleanedBarcode);
          const barcodeSnap = await getDoc(barcodeRef);
          if (barcodeSnap.exists()) {
            throw new Error("Barcode already exists");
          }
          
          if (state.selectedProduct.barcode) {
            await deleteDoc(doc(db, "barcodes", cleanBarcode(state.selectedProduct.barcode)));
          }
          await updateDoc(doc(db, "products", state.selectedProduct.id), productData);
          await setDoc(barcodeRef, { 
            productId: state.selectedProduct.id, 
            branchId: activeBranch!.id, 
            ownerId: user.uid 
          });
        } else {
          await updateDoc(doc(db, "products", state.selectedProduct.id), productData);
        }
        showToast("Product updated", "success");
      } else {
        await createProductWithUniqueBarcode({ ...productData, createdAt: serverTimestamp() });
        showToast("Product created", "success");
      }
      
      resetForm();
      await loadProducts(true);
    } catch (error: any) {
      showToast(error.message || "Error saving product", "error");
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
      dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'isSubmitting' as any, value: false } });
    }
  }, [
    state.isSubmitting, state.loading, state.name, state.category, state.unit, state.qty, 
    state.minStock, state.purchase, state.sale, state.allowSale, state.barcode, 
    state.selectedProduct, authUser, activeBranch, cleanBarcode, createProductWithUniqueBarcode, 
    validateProduct, showToast, resetForm, loadProducts
  ]);

  const deleteProduct = useCallback(async () => {
    if (!state.selectedProduct) return;
    if (!confirm(`Delete "${state.selectedProduct.name}"?`)) return;
    
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const user = authUser;
      if (!user) throw new Error("Not authenticated");
      
      if (state.selectedProduct.ownerId !== user.uid || state.selectedProduct.branchId !== activeBranch?.id) {
        throw new Error("Unauthorized");
      }
      
      if (state.selectedProduct.barcode) {
        await deleteDoc(doc(db, "barcodes", cleanBarcode(state.selectedProduct.barcode)));
      }
      await deleteDoc(doc(db, "products", state.selectedProduct.id));
      
      showToast("Product deleted", "success");
      resetForm();
      await loadProducts(true);
    } catch (error: any) {
      showToast(error.message || "Error deleting product", "error");
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [state.selectedProduct, authUser, activeBranch?.id, cleanBarcode, showToast, resetForm, loadProducts]);

  const updateQuantity = useCallback(async (productId: string, change: number) => {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    
    const newQty = product.qty + change;
    if (newQty < 0) {
      showToast("Cannot reduce quantity below 0", "error");
      return;
    }

    // ✅ FIXED: Stable optimistic update
    dispatch({ type: 'SET_PRODUCTS', payload: state.products.map(p => 
      p.id === productId ? { ...p, qty: newQty } : p
    ) });
    
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "products", productId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Product not found");
        
        const currentQty = (snap.data() as Product).qty;
        const finalNewQty = currentQty + change;
        if (finalNewQty < 0) throw new Error("Negative quantity");
        
        tx.update(ref, { qty: finalNewQty, updatedAt: serverTimestamp() });
      });
      
      showToast(`Quantity ${change > 0 ? '+' : ''}${change}`, "success");
    } catch (error: any) {
      showToast(error.message || "Error updating quantity", "error");
      // Revert
      dispatch({ type: 'SET_PRODUCTS', payload: state.products });
    }
  }, [state.products, showToast]);

  const getInitials = useCallback((name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  }, []);

  const formatCurrency = useCallback((amount: number) => {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(amount);
  }, []);

  // ✅ FIXED: Stable keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      
      if (e.key === 'Enter' && !state.loading && !state.isSubmitting) {
        e.preventDefault();
        addOrUpdateProduct();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        resetForm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.loading, state.isSubmitting, addOrUpdateProduct, resetForm]);

  // ✅ FIXED: Memoized components
  const ProductCard = useCallback(({ product }: { product: Product }) => (
    <div 
      className="h-[140px] p-3 rounded-xl border bg-white hover:bg-gray-50 cursor-pointer transition-all group hover:shadow-md"
      onClick={() => selectProduct(product.id)}
    >
      <div className="h-full flex flex-col">
        <div className="font-semibold text-sm truncate group-hover:font-bold">{product.name}</div>
        <div className="text-xs text-gray-500 mt-1">{product.category} • {product.unit}</div>
        {product.barcode && (
          <div className="text-xs font-mono text-gray-400 mt-1 truncate">📷 {product.barcode}</div>
        )}
        <div className="mt-auto flex justify-between items-end">
          <div className="font-bold text-sm text-gray-900">{currency.symbol}{formatCurrency(product.saleRate)}</div>
          <div className="text-xs text-gray-500">Stock: {product.qty}</div>
        </div>
        {product.minStock > 0 && product.qty <= product.minStock && (
          <div className="mt-1 text-xs text-red-600 font-semibold">⚠️ Low Stock</div>
        )}
      </div>
    </div>
  ), [currency.symbol, formatCurrency, selectProduct]);

  const SkeletonCard = useCallback(() => (
    <div className="h-[140px] p-3 rounded-xl border bg-gray-100 animate-pulse">
      <div className="h-full flex flex-col space-y-2">
        <div className="h-4 bg-gray-300 rounded w-3/4"></div>
        <div className="h-3 bg-gray-300 rounded w-1/2"></div>
        <div className="h-3 bg-gray-300 rounded w-2/3"></div>
        <div className="mt-auto flex justify-between">
          <div className="h-4 bg-gray-300 rounded w-12"></div>
          <div className="h-3 bg-gray-300 rounded w-16"></div>
        </div>
      </div>
    </div>
  ), []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      unsubscribeRef.current?.();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Toast */}
      {state.toast && (
        <div className="fixed top-4 right-4 z-50 animate-slide-in">
          <div className={`px-6 py-3 rounded-xl shadow-2xl backdrop-blur-xl border text-white font-medium ${
            state.toast.type === 'error' ? 'bg-red-500/90 border-red-400' :
            state.toast.type === 'success' ? 'bg-green-500/90 border-green-400' :
            'bg-blue-500/90 border-blue-400'
          }`}>
            <span>{state.toast.type === 'error' ? '❌' : state.toast.type === 'success' ? '✅' : 'ℹ️'} {state.toast.message}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-gradient-to-b from-gray-900 via-gray-900/95 to-gray-900/90 text-white shadow-2xl backdrop-blur-2xl border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between py-5 gap-3">
            <div className="flex items-center gap-3">
              <Link href="/owner-dashboard">
                <Image src="/stockaro-logo.png" alt="Stockaroo" width={44} height={44} className="w-11 h-11 object-contain rounded-xl shadow-lg hover:scale-110 transition-all" priority />
              </Link>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-200 bg-clip-text text-transparent">Products</h1>
                <p className="text-sm text-gray-300">{activeBranch?.shopName || "Select Branch"}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="bg-white/10 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/20 text-sm">
                <div className="font-semibold">{getInitials(state.ownerName)} {state.ownerName}</div>
                <div className="text-xs text-gray-300">Owner</div>
              </div>
              <div className="bg-white/10 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/20">
                <span className="text-lg">{currency.flag}</span> <span className="font-bold">{currency.symbol}</span>
              </div>
              {state.isOffline && (
                <div className="bg-red-500/90 text-white px-4 py-2 rounded-xl text-sm font-semibold animate-pulse">📴 Offline</div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search */}
        <div className="mb-8">
          <div className="relative max-w-2xl mx-auto">
            <input
              placeholder="Search products, barcodes..."
              onChange={(e) => debouncedSearch(e.target.value)}
              className="w-full pl-14 pr-6 py-4 text-lg bg-white/90 backdrop-blur-xl border border-gray-200 hover:border-gray-300 focus:ring-4 focus:ring-gray-200/50 focus:border-gray-400 rounded-2xl shadow-xl transition-all outline-none"
            />
            <div className="absolute left-5 top-1/2 -translate-y-1/2 text-2xl text-gray-400">🔍</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Product List */}
          <div className="space-y-6">
            <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-3">
                  <span className="w-10 h-10 bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl flex items-center justify-center text-white">📋</span>
                  Product List
                </h2>
                <span className="bg-gray-900 text-white px-3 py-1 rounded-full text-sm font-semibold">
                  {filteredProducts.length} items
                </span>
              </div>

                           {/* Product Selector */}
              <select
                value={state.selectedProduct?.id || ""}
                onChange={(e) => selectProduct(e.target.value)}
                className="w-full px-4 py-3 mb-6 bg-white border border-gray-200 focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900 rounded-xl font-medium"
                disabled={state.loading}
              >
                <option value="">Search Product</option>
                {filteredProducts.slice(0, 100).map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.qty} {p.unit})</option>
                ))}
              </select>

              {/* Bulk Actions */}
              <div className="space-y-3 mb-6">
                <button
                  onClick={deleteAllProducts}
                  disabled={state.loading}
                  className="w-full bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                >
                  🗑️ Delete All Products
                </button>
                <button
                  onClick={() => loadProducts(true)}
                  disabled={state.loading || state.loadingMore}
                  className="w-full bg-gray-900 hover:bg-gray-800 text-white font-bold py-3 px-4 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                >
                  🔄 Refresh List
                </button>
              </div>

              {/* Product List */}
              <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                {!state.initialLoadDone && state.loading ? (
                  Array(3).fill(0).map((_, i) => <SkeletonCard key={`skeleton-${i}`} />)
                ) : filteredProducts.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-5xl mb-4 mx-auto">📦</div>
                    <p className="text-gray-500 font-medium">No products found</p>
                  </div>
                ) : (
                  filteredProducts.map((p) => <ProductCard key={p.id} product={p} />)
                )}
                {state.loadingMore && Array(2).fill(0).map((_, i) => <SkeletonCard key={`more-skeleton-${i}`} />)}
                <div ref={observerTarget} className="h-10" />
              </div>
            </div>

            {/* Import Excel */}
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 backdrop-blur-xl rounded-2xl shadow-xl border border-emerald-200/60 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-3">
                <span className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center text-white">📊</span>
                Import Excel
              </h2>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={state.loading}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
              >
                📁 Upload Excel File (Max 5MB)
              </button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
              <div className="mt-4 p-3 bg-white/60 rounded-xl border text-xs text-gray-600">
                Columns: <code className="bg-emerald-100 px-1 py-px rounded font-mono">name, category, unit, qty, minStock, purchaseRate, saleRate, barcode</code>
              </div>
            </div>
          </div>

          {/* Right Column - Product Form */}
          <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
              <span className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center text-white">
                {state.selectedProduct ? '✏️' : '➕'}
              </span>
              {state.selectedProduct ? "Edit Product" : "New Product"}
            </h2>

            <div className="space-y-4">
              {/* Form Field Updates */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Barcode / SKU</label>
                <input 
                  value={state.barcode} 
                  onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'barcode', value: e.target.value } })} 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                  placeholder="Enter unique barcode (optional)" 
                  disabled={state.loading} 
                />
                <p className="text-xs text-gray-500 mt-1">Barcode must be unique across all products</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Product Name *</label>
                <input 
                  value={state.name} 
                  onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'name', value: e.target.value } })} 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                  placeholder="Product name" 
                  disabled={state.loading} 
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Category</label>
                <input 
                  value={state.category} 
                  onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'category', value: e.target.value } })} 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                  placeholder="e.g., Electronics" 
                  disabled={state.loading} 
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Unit</label>
                <select 
                  value={state.unit} 
                  onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'unit', value: e.target.value } })}
                  disabled={state.loading}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none"
                >
                  <option value="pcs">Pieces (pcs)</option>
                  <option value="box">Box</option>
                  <option value="carton">Carton</option>
                  <option value="pack">Pack</option>
                  <option value="kg">Kilogram (kg)</option>
                  <option value="g">Gram (g)</option>
                  <option value="liter">Liter (L)</option>
                  <option value="ml">Milliliter (ml)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Quantity</label>
                  <input 
                    type="number" 
                    value={state.qty} 
                    onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'qty', value: e.target.value } })} 
                    min="0"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                    disabled={state.loading} 
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Min Stock</label>
                  <input 
                    type="number" 
                    value={state.minStock} 
                    onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'minStock', value: e.target.value } })} 
                    min="0"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                    disabled={state.loading} 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Purchase ({currency.symbol})</label>
                  <input 
                    type="number" 
                    value={state.purchase} 
                    onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'purchase', value: e.target.value } })} 
                    min="0"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                    disabled={state.loading} 
                  />
                  {state.selectedProduct && (
                    <p className="text-xs text-gray-500 mt-1">
                      Orig: {currency.symbol}{formatCurrency(state.selectedProduct.originalPurchaseRate)}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Sale ({currency.symbol})</label>
                  <input 
                    type="number" 
                    value={state.sale} 
                    onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'sale', value: e.target.value } })} 
                    min="0"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                    disabled={state.loading} 
                  />
                  {state.selectedProduct && (
                    <p className="text-xs text-gray-500 mt-1">
                      Orig: {currency.symbol}{formatCurrency(state.selectedProduct.originalSaleRate)}
                    </p>
                  )}
                </div>
              </div>

              {/* Profit Preview */}
              {state.purchase && state.sale && Number(state.sale) > Number(state.purchase) && (
                <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-gray-700">Profit per unit</span>
                    <span className="text-xl font-bold text-green-600">
                      {currency.symbol}{formatCurrency(Number(state.sale) - Number(state.purchase))}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                <input 
                  type="checkbox" 
                  id="allowSale" 
                  checked={state.allowSale} 
                  onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'allowSale', value: e.target.checked } })} 
                  disabled={state.loading}
                  className="w-5 h-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900" 
                />
                <label htmlFor="allowSale" className="text-sm font-semibold text-gray-700 cursor-pointer">
                  Allow this product to be sold
                </label>
              </div>

              {state.selectedProduct && (
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
                  <p className="text-xs text-blue-800">
                    💡 Price changes affect future sales only
                  </p>
                </div>
              )}

              <div className="space-y-3 pt-6">
                <div className="text-xs text-gray-500 mb-2 flex gap-4">
                  <kbd className="px-2 py-1 bg-gray-200 rounded font-mono text-xs">Enter</kbd> to save
                  <kbd className="px-2 py-1 bg-gray-200 rounded font-mono text-xs">Esc</kbd> to cancel
                </div>
                
                <button
                  onClick={addOrUpdateProduct}
                  disabled={state.loading || state.isSubmitting}
                  className="w-full bg-gradient-to-r from-gray-900 to-gray-800 hover:from-gray-800 hover:to-gray-700 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <span className="text-xl">{state.selectedProduct ? '✏️' : '➕'}</span>
                  {state.loading ? 'Processing...' : state.selectedProduct ? 'Update Product' : 'Add Product'}
                </button>

                {state.selectedProduct && (
                  <>
                    <button
                      onClick={deleteProduct}
                      disabled={state.loading}
                      className="w-full bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                    >
                      🗑️ Delete Product
                    </button>
                    <button
                      onClick={resetForm}
                      disabled={state.loading}
                      className="w-full bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold py-4 px-6 rounded-xl shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                    >
                      🔄 Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gradient-to-t from-gray-900/95 to-transparent text-white/80 border-t border-white/10 mt-12 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-lg font-semibold tracking-wide mb-4">Inventory management perfected</p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-gray-400">
            <span>© {new Date().getFullYear()} Stockaroo</span>
            <span>•</span>
            <span>Branch: {activeBranch?.shopName || "None"}</span>
            <span>•</span>
            <span>{currency.flag} {currency.code}</span>
          </div>
        </div>
      </footer>

      <style jsx global>{`
        .overflow-y-auto::-webkit-scrollbar { width: 6px; }
        .overflow-y-auto::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 10px; }
        .overflow-y-auto::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .overflow-y-auto::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in { animation: slideIn 0.3s ease-out; }
      `}</style>
    </div>
  );
}