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

interface Branch {
  id: string;
  shopName: string;
  isActive: boolean;
  isMain: boolean;
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
  branches: Branch[];
  selectedBranchId: string | null;
}

type AppAction =
  | { type: 'SET_PRODUCTS'; payload: Product[] }
  | { type: 'SET_SELECTED_PRODUCT'; payload: Product | null }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_SUBMITTING'; payload: boolean }
  | { type: 'SET_LOADING_MORE'; payload: boolean }
  | { type: 'SET_LAST_DOC'; payload: QueryDocumentSnapshot<DocumentData> | null }
  | { type: 'SET_HAS_MORE'; payload: boolean }
  | { type: 'SET_FORM_FIELD'; payload: { field: keyof Pick<AppState, 'name'|'category'|'unit'|'qty'|'minStock'|'purchase'|'sale'|'barcode'|'allowSale'>; value: any } }
  | { type: 'RESET_FORM' }
  | { type: 'SET_SEARCH_TERM'; payload: string }
  | { type: 'SET_TOAST'; payload: { message: string; type: string } | null }
  | { type: 'SET_OFFLINE'; payload: boolean }
  | { type: 'SET_OWNER_NAME'; payload: string }
  | { type: 'SET_BRANCHES'; payload: Branch[] }
  | { type: 'SET_SELECTED_BRANCH'; payload: string | null };

const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'SET_PRODUCTS':
      return { ...state, products: action.payload };
    case 'SET_SELECTED_PRODUCT':
      return { ...state, selectedProduct: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_SUBMITTING':
      return { ...state, isSubmitting: action.payload };
    case 'SET_LOADING_MORE':
      return { ...state, loadingMore: action.payload };
    case 'SET_LAST_DOC':
      return { ...state, lastDoc: action.payload };
    case 'SET_HAS_MORE':
      return { ...state, hasMore: action.payload };
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
    case 'SET_BRANCHES':
      return { ...state, branches: action.payload };
    case 'SET_SELECTED_BRANCH':
      return { ...state, selectedBranchId: action.payload, products: [], lastDoc: null, hasMore: true };
    default:
      return state;
  }
};

// Debounce hook with fixed type
function useDebounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  
  const debounced = useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => func(...args), wait);
  }, [func, wait]) as T;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return debounced;
}

const PAGE_SIZE = 50;
const BATCH_SIZE = 400;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export default function Products() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const observerTarget = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const requestIdRef = useRef(0);
  const isLoadingProductsRef = useRef(false);

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
    branches: [],
    selectedBranchId: null,
  });

  const [authUser, setAuthUser] = useState<any>(null);
  const [currency, setCurrency] = useState<CurrencyOption>({
    symbol: "₨", code: "PKR", name: "Pakistani Rupee", flag: "🇵🇰"
  });

  const currencies: CurrencyOption[] = [
    { symbol: "₨", code: "PKR", name: "Pakistani Rupee", flag: "🇵🇰" },
    { symbol: "$", code: "USD", name: "US Dollar", flag: "🇺🇸" },
    { symbol: "€", code: "EUR", name: "Euro", flag: "🇪🇺" },
    { symbol: "£", code: "GBP", name: "British Pound", flag: "🇬🇧" },
  ];

  // ============================================
  // HELPER FUNCTIONS - USER SUBCOLLECTION
  // ============================================
  const getUserProductsRef = useCallback((userId: string) => {
    return collection(db, "users", userId, "products");
  }, []);

  const getUserProductDoc = useCallback((userId: string, productId: string) => {
    return doc(db, "users", userId, "products", productId);
  }, []);

  const getUserBarcodeDoc = useCallback((userId: string, barcode: string) => {
    return doc(db, "users", userId, "barcodes", barcode);
  }, []);

  const getUserBranchesRef = useCallback((userId: string) => {
    return collection(db, "users", userId, "branches");
  }, []);

  // Filtered products based on search
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

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
    });
    return unsubscribe;
  }, []);

  // Online/offline status
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

  // Load user data and branches
  useEffect(() => {
    if (!authUser) return;
    
    const loadUserData = async () => {
      try {
        dispatch({ type: 'SET_LOADING', payload: true });
        
        const userDoc = await getDoc(doc(db, "users", authUser.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          dispatch({ type: 'SET_OWNER_NAME', payload: userData.name || "Owner" });
          if (userData.currency) {
            const savedCurrency = currencies.find(c => c.code === userData.currency);
            if (savedCurrency) setCurrency(savedCurrency);
          }
        }

        const branchesRef = getUserBranchesRef(authUser.uid);
        const branchesSnap = await getDocs(branchesRef);
        const branchesList: Branch[] = branchesSnap.docs.map(doc => ({
          id: doc.id,
          shopName: doc.data().shopName,
          isActive: doc.data().isActive,
          isMain: doc.data().isMain || false,
        }));
        
        dispatch({ type: 'SET_BRANCHES', payload: branchesList });
        
        const mainBranch = branchesList.find(b => b.isMain === true && b.isActive !== false);
        const defaultBranch = mainBranch || branchesList.find(b => b.isActive !== false);
        if (defaultBranch && !state.selectedBranchId) {
          dispatch({ type: 'SET_SELECTED_BRANCH', payload: defaultBranch.id });
        }
        
        dispatch({ type: 'SET_LOADING', payload: false });
      } catch (error) {
        console.error("Error loading user data:", error);
        dispatch({ type: 'SET_LOADING', payload: false });
        showToast("Failed to load user data", "error");
      }
    };
    loadUserData();
  }, [authUser]); // Removed currencies and getUserBranchesRef to prevent re-runs

  // ============================================
  // LOAD PRODUCTS - FIXED: Removed state.products from dependencies
  // ============================================
  const loadProducts = useCallback(async (reset: boolean = true) => {
    // Prevent concurrent loads
    if (isLoadingProductsRef.current) {
      console.log("⏭️ Skipping - already loading products");
      return;
    }
    
    const requestId = ++requestIdRef.current;
    isLoadingProductsRef.current = true;
    
    console.log("🔍 loadProducts called:", { 
      branchId: state.selectedBranchId, 
      userId: authUser?.uid,
      reset,
      requestId
    });
    
    if (!state.selectedBranchId || !authUser) {
      console.log("❌ Cannot load: missing branch or user");
      isLoadingProductsRef.current = false;
      return;
    }
    
    if (reset) {
      dispatch({ type: 'SET_LOADING', payload: true });
      dispatch({ type: 'SET_PRODUCTS', payload: [] });
      dispatch({ type: 'SET_LAST_DOC', payload: null });
      dispatch({ type: 'SET_HAS_MORE', payload: true });
    }
    
    if (!reset && (!state.hasMore || state.loadingMore)) {
      if (reset) dispatch({ type: 'SET_LOADING', payload: false });
      isLoadingProductsRef.current = false;
      return;
    }
    
    if (!reset) {
      dispatch({ type: 'SET_LOADING_MORE', payload: true });
    }
    
    try {
      const productsRef = getUserProductsRef(authUser.uid);
      
      const constraints: QueryConstraint[] = [
        where("branchId", "==", state.selectedBranchId),
        orderBy("name", "asc"),
        limit(PAGE_SIZE)
      ];
      
      if (!reset && state.lastDoc) {
        constraints.push(startAfter(state.lastDoc));
      }
      
      const productsQuery = query(productsRef, ...constraints);
      const snap = await getDocs(productsQuery);
      
      // Check if this response is still valid (race condition guard)
      if (requestId !== requestIdRef.current) {
        console.log("⚠️ Ignoring stale response", { requestId, current: requestIdRef.current });
        isLoadingProductsRef.current = false;
        return;
      }
      
      const newProducts: Product[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Product, 'id'>)
      }));
      
      console.log("✅ Products fetched:", newProducts.length);
      
      if (reset) {
        dispatch({ type: 'SET_PRODUCTS', payload: newProducts });
      } else {
        dispatch({ type: 'SET_PRODUCTS', payload: [...state.products, ...newProducts] });
      }
      
      dispatch({ type: 'SET_LAST_DOC', payload: snap.docs[snap.docs.length - 1] || null });
      dispatch({ type: 'SET_HAS_MORE', payload: snap.docs.length === PAGE_SIZE });
      
    } catch (error: any) {
      if (requestId !== requestIdRef.current) {
        isLoadingProductsRef.current = false;
        return;
      }
      
      console.error("❌ Load products error:", error);
      if (error.message?.includes("index")) {
        showToast("Need to create database index. Check Firebase console.", "error");
      } else {
        showToast("Failed to load products", "error");
      }
    } finally {
      if (requestId === requestIdRef.current) {
        dispatch({ type: 'SET_LOADING', payload: false });
        dispatch({ type: 'SET_LOADING_MORE', payload: false });
        isLoadingProductsRef.current = false;
      }
    }
  }, [state.selectedBranchId, authUser, state.hasMore, state.loadingMore, state.lastDoc, getUserProductsRef, showToast]); // ✅ REMOVED state.products

  // Load products when branch changes
  useEffect(() => {
    if (state.selectedBranchId && authUser) {
      console.log("🔄 Branch changed or user loaded, fetching products...");
      loadProducts(true);
    }
  }, [state.selectedBranchId, authUser]); // ✅ REMOVED loadProducts from dependencies

  // Infinite scroll observer with proper cleanup
  useEffect(() => {
    if (!observerTarget.current || !state.hasMore || state.loadingMore || state.loading) return;

    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && state.hasMore && !state.loadingMore && !state.loading) {
          console.log("📜 Loading more products...");
          loadProducts(false);
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    observer.observe(observerTarget.current);
    observerRef.current = observer;

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [state.hasMore, state.loadingMore, state.loading, loadProducts]);

  // Create product with unique barcode
  const createProductWithUniqueBarcode = useCallback(async (productData: any) => {
    const user = authUser;
    if (!user || !state.selectedBranchId) throw new Error("Missing user or branch");

    const barcodeValue = productData.barcode;
    if (!barcodeValue) {
      const productsRef = getUserProductsRef(user.uid);
      return await addDoc(productsRef, productData);
    }

    const cleanBar = cleanBarcode(barcodeValue);
    if (!cleanBar) {
      const productsRef = getUserProductsRef(user.uid);
      return await addDoc(productsRef, productData);
    }

    let productId = "";
    
    await runTransaction(db, async (tx) => {
      const barcodeRef = getUserBarcodeDoc(user.uid, cleanBar);
      const barcodeSnap = await tx.get(barcodeRef);

      if (barcodeSnap.exists()) {
        throw new Error(`Barcode ${cleanBar} already exists`);
      }

      const productsRef = getUserProductsRef(user.uid);
      const productRef = doc(productsRef);
      productId = productRef.id;
      
      tx.set(productRef, { ...productData, barcode: cleanBar, id: productId });
      tx.set(barcodeRef, { 
        productId, 
        branchId: state.selectedBranchId,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      });
    });
    
    return { id: productId };
  }, [authUser, state.selectedBranchId, cleanBarcode, getUserProductsRef, getUserBarcodeDoc]);

  // Import products from Excel with chunking and duplicate check
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
      if (!user || !state.selectedBranchId) {
        showToast("Please select a branch first", "error");
        return;
      }

      let successCount = 0;
      let errorCount = 0;
      const productsRef = getUserProductsRef(user.uid);
      const maxRows = Math.min(json.length, 1000);

      for (let i = 0; i < maxRows; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = json.slice(i, Math.min(i + BATCH_SIZE, maxRows));
        
        for (const row of chunk) {
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

          const cleanBar = row.barcode ? cleanBarcode(String(row.barcode)) : "";
          
          if (cleanBar) {
            const barcodeRef = getUserBarcodeDoc(user.uid, cleanBar);
            const barcodeSnap = await getDoc(barcodeRef);
            if (barcodeSnap.exists()) {
              errorCount++;
              continue;
            }
          }

          const ref = doc(productsRef);
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
            branchId: state.selectedBranchId,
            ownerId: user.uid,
            createdAt: serverTimestamp(),
            barcode: cleanBar,
          });
          
          if (cleanBar) {
            const barcodeMappingRef = getUserBarcodeDoc(user.uid, cleanBar);
            batch.set(barcodeMappingRef, {
              productId: ref.id,
              branchId: state.selectedBranchId,
              ownerId: user.uid,
              createdAt: serverTimestamp()
            });
          }
          
          successCount++;
        }
        
        await batch.commit();
      }

      showToast(`Imported ${successCount} products (${errorCount} skipped)`, "success");
      loadProducts(true);
    } catch (error) {
      console.error("Import error:", error);
      showToast("Error importing products", "error");
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [authUser, state.selectedBranchId, cleanBarcode, showToast, loadProducts, getUserProductsRef, getUserBarcodeDoc]);

  // Delete all products
  const deleteAllProducts = useCallback(async () => {
    const user = authUser;
    if (!user || !state.selectedBranchId) {
      showToast("Please select a branch first", "error");
      return;
    }

    if (!confirm("⚠️ WARNING: Delete ALL products in this branch?")) return;

    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      let lastSnapshot: QueryDocumentSnapshot<DocumentData> | null = null;
      let totalDeleted = 0;
      const productsRef = getUserProductsRef(user.uid);

      while (true) {
        const constraints: QueryConstraint[] = [
          where("branchId", "==", state.selectedBranchId),
          orderBy("name"),
          limit(BATCH_SIZE)
        ];
        
        if (lastSnapshot) {
          constraints.push(startAfter(lastSnapshot));
        }
        
        const q = query(productsRef, ...constraints);
        const snap = await getDocs(q);
        
        if (snap.empty) break;
        
        const batch = writeBatch(db);
        snap.docs.forEach((docSnap) => {
          const barcode = docSnap.data().barcode;
          if (barcode) {
            batch.delete(getUserBarcodeDoc(user.uid, cleanBarcode(String(barcode))));
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
  }, [authUser, state.selectedBranchId, cleanBarcode, showToast, loadProducts, getUserProductsRef, getUserBarcodeDoc]);

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
    if (!authUser || !state.selectedBranchId) {
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
  }, [authUser, state.selectedBranchId, state.name, state.qty, state.minStock, state.purchase, state.sale, showToast]);

  // Add or update product with proper submitting state
  const addOrUpdateProduct = useCallback(async () => {
    if (state.isSubmitting || state.loading) return;
    if (!validateProduct()) return;
    
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_SUBMITTING', payload: true });

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
        branchId: state.selectedBranchId,
        barcode: cleanedBarcode,
        updatedAt: serverTimestamp()
      };

      if (state.selectedProduct) {
        if (cleanedBarcode && cleanedBarcode !== state.selectedProduct.barcode) {
          const barcodeRef = getUserBarcodeDoc(user.uid, cleanedBarcode);
          const barcodeSnap = await getDoc(barcodeRef);
          if (barcodeSnap.exists()) {
            throw new Error("Barcode already exists");
          }
          
          if (state.selectedProduct.barcode) {
            await deleteDoc(getUserBarcodeDoc(user.uid, cleanBarcode(state.selectedProduct.barcode)));
          }
          
          const productRef = getUserProductDoc(user.uid, state.selectedProduct.id);
          await updateDoc(productRef, productData);
          await setDoc(barcodeRef, { 
            productId: state.selectedProduct.id, 
            branchId: state.selectedBranchId, 
            ownerId: user.uid 
          });
        } else {
          const productRef = getUserProductDoc(user.uid, state.selectedProduct.id);
          await updateDoc(productRef, productData);
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
      dispatch({ type: 'SET_SUBMITTING', payload: false });
    }
  }, [
    state.isSubmitting, state.loading, state.name, state.category, state.unit, state.qty, 
    state.minStock, state.purchase, state.sale, state.allowSale, state.barcode, 
    state.selectedProduct, state.selectedBranchId, authUser, cleanBarcode, 
    createProductWithUniqueBarcode, validateProduct, showToast, resetForm, loadProducts,
    getUserProductDoc, getUserBarcodeDoc
  ]);

  // Delete single product
  const deleteProduct = useCallback(async () => {
    if (!state.selectedProduct) return;
    if (!confirm(`Delete "${state.selectedProduct.name}"?`)) return;
    
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const user = authUser;
      if (!user) throw new Error("Not authenticated");
      
      if (state.selectedProduct.barcode) {
        await deleteDoc(getUserBarcodeDoc(user.uid, cleanBarcode(state.selectedProduct.barcode)));
      }
      const productRef = getUserProductDoc(user.uid, state.selectedProduct.id);
      await deleteDoc(productRef);
      
      showToast("Product deleted", "success");
      resetForm();
      await loadProducts(true);
    } catch (error: any) {
      showToast(error.message || "Error deleting product", "error");
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [state.selectedProduct, authUser, cleanBarcode, showToast, resetForm, loadProducts, getUserProductDoc, getUserBarcodeDoc]);

  const getInitials = useCallback((name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  }, []);

  const formatCurrency = useCallback((amount: number) => {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(amount);
  }, []);

  // Keyboard shortcuts
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

  // Cleanup
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  if (!authUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">Please login to continue...</p>
        </div>
      </div>
    );
  }

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
                <p className="text-sm text-gray-300">Manage your inventory</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {state.branches.length > 0 && (
                <select
                  value={state.selectedBranchId || ""}
                  onChange={(e) => {
                    console.log("🔄 Branch changed to:", e.target.value);
                    dispatch({ type: 'SET_SELECTED_BRANCH', payload: e.target.value });
                  }}
                  className="bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-white text-sm focus:outline-none"
                >
                  <option value="" className="text-gray-900">Select Branch</option>
                  {state.branches.map(branch => (
                    <option key={branch.id} value={branch.id} className="text-gray-900">
                      {branch.shopName}
                    </option>
                  ))}
                </select>
              )}

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
              id="search"
              name="search"
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

              <select
                id="productSelector"
                name="productSelector"
                value={state.selectedProduct?.id || ""}
                onChange={(e) => selectProduct(e.target.value)}
                className="w-full px-4 py-3 mb-6 bg-white border border-gray-200 focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900 rounded-xl font-medium"
                disabled={state.loading}
              >
                <option value="">Select or Search Product</option>
                {filteredProducts.slice(0, 100).map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.qty} {p.unit})</option>
                ))}
              </select>

              <div className="space-y-3 mb-6">
                <button
                  onClick={deleteAllProducts}
                  disabled={state.loading || !state.selectedBranchId}
                  className="w-full bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 text-white font-bold py-3 px-4 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                >
                  🗑️ Delete All Products
                </button>
                <button
                  onClick={() => loadProducts(true)}
                  disabled={state.loading || state.loadingMore || !state.selectedBranchId}
                  className="w-full bg-gray-900 hover:bg-gray-800 text-white font-bold py-3 px-4 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                >
                  🔄 Refresh List
                </button>
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                {state.loading && state.products.length === 0 ? (
                  Array(6).fill(0).map((_, i) => <SkeletonCard key={`skeleton-${i}`} />)
                ) : filteredProducts.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-5xl mb-4 mx-auto">📦</div>
                    <p className="text-gray-500 font-medium">No products found</p>
                    {!state.selectedBranchId && (
                      <p className="text-sm text-gray-400 mt-2">Please select a branch first</p>
                    )}
                    {state.selectedBranchId && state.products.length === 0 && !state.loading && (
                      <button 
                        onClick={() => loadProducts(true)}
                        className="mt-4 text-blue-500 underline"
                      >
                        Click to retry loading
                      </button>
                    )}
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
                disabled={state.loading || !state.selectedBranchId}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 text-white font-bold py-4 px-6 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
              >
                📁 Upload Excel File (Max 5MB)
              </button>
              <input 
                ref={fileInputRef} 
                id="excelUpload"
                name="excelUpload"
                type="file" 
                accept=".xlsx,.xls" 
                onChange={handleImport} 
                className="hidden" 
              />
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
              <div>
                <label htmlFor="barcode" className="block text-sm font-semibold text-gray-700 mb-1">Barcode / SKU</label>
                <input 
                  id="barcode"
                  name="barcode"
                  value={state.barcode} 
                  onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'barcode', value: e.target.value } })} 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                  placeholder="Enter unique barcode (optional)" 
                  disabled={state.loading} 
                />
                <p className="text-xs text-gray-500 mt-1">Barcode must be unique across all products</p>
              </div>

              <div>
                <label htmlFor="productName" className="block text-sm font-semibold text-gray-700 mb-1">Product Name *</label>
                <input 
                  id="productName"
                  name="productName"
                  value={state.name} 
                  onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'name', value: e.target.value } })} 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                  placeholder="Product name" 
                  disabled={state.loading} 
                />
              </div>

              <div>
                <label htmlFor="category" className="block text-sm font-semibold text-gray-700 mb-1">Category</label>
                <input 
                  id="category"
                  name="category"
                  value={state.category} 
                  onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'category', value: e.target.value } })} 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                  placeholder="e.g., Electronics" 
                  disabled={state.loading} 
                />
              </div>

              <div>
                <label htmlFor="unit" className="block text-sm font-semibold text-gray-700 mb-1">Unit</label>
                <select 
                  id="unit"
                  name="unit"
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
                  <label htmlFor="qty" className="block text-sm font-semibold text-gray-700 mb-1">Quantity</label>
                  <input 
                    id="qty"
                    name="qty"
                    type="number" 
                    value={state.qty} 
                    onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'qty', value: e.target.value } })} 
                    min="0"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                    disabled={state.loading} 
                  />
                </div>
                <div>
                  <label htmlFor="minStock" className="block text-sm font-semibold text-gray-700 mb-1">Min Stock</label>
                  <input 
                    id="minStock"
                    name="minStock"
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
                  <label htmlFor="purchase" className="block text-sm font-semibold text-gray-700 mb-1">Purchase ({currency.symbol})</label>
                  <input 
                    id="purchase"
                    name="purchase"
                    type="number" 
                    value={state.purchase} 
                    onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'purchase', value: e.target.value } })} 
                    min="0"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                    disabled={state.loading} 
                  />
                </div>
                <div>
                  <label htmlFor="sale" className="block text-sm font-semibold text-gray-700 mb-1">Sale ({currency.symbol})</label>
                  <input 
                    id="sale"
                    name="sale"
                    type="number" 
                    value={state.sale} 
                    onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'sale', value: e.target.value } })} 
                    min="0"
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none" 
                    disabled={state.loading} 
                  />
                </div>
              </div>

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
                  name="allowSale"
                  checked={state.allowSale} 
                  onChange={e => dispatch({ type: 'SET_FORM_FIELD', payload: { field: 'allowSale', value: e.target.checked } })} 
                  disabled={state.loading}
                  className="w-5 h-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900" 
                />
                <label htmlFor="allowSale" className="text-sm font-semibold text-gray-700 cursor-pointer">
                  Allow this product to be sold
                </label>
              </div>

              <div className="space-y-3 pt-6">
                <div className="text-xs text-gray-500 mb-2 flex gap-4">
                  <kbd className="px-2 py-1 bg-gray-200 rounded font-mono text-xs">Enter</kbd> to save
                  <kbd className="px-2 py-1 bg-gray-200 rounded font-mono text-xs">Esc</kbd> to cancel
                </div>
                
                <button
                  onClick={addOrUpdateProduct}
                  disabled={state.loading || state.isSubmitting || !state.selectedBranchId}
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

      <footer className="bg-gradient-to-t from-gray-900/95 to-transparent text-white/80 border-t border-white/10 mt-12 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-lg font-semibold tracking-wide mb-4">Inventory management perfected</p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-gray-400">
            <span>© {new Date().getFullYear()} Stockaroo</span>
            <span>•</span>
            <span>Branch: {state.branches.find(b => b.id === state.selectedBranchId)?.shopName || "None"}</span>
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