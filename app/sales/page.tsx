"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  onSnapshot,
  orderBy,
  serverTimestamp,
  runTransaction,
  limit,
  increment,
  getDoc,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { useBranch } from "@/context/BranchContext";
import Image from "next/image";
import Link from "next/link";
import { BrowserMultiFormatReader, NotFoundException } from "@zxing/library";

// Debug mode - set to false in production
const DEBUG = false;

interface Product {
  id: string;
  name: string;
  barcode?: string;
  qty: number;
  saleRate: number;
  originalSaleRate?: number;
  profit: number;
  originalProfit?: number;
  allowSale: boolean;
  purchaseRate?: number;
  originalPurchaseRate?: number;
}

interface CartItem {
  id: string;
  name: string;
  qty: number;
  price: number;
  profit: number;
  purchaseRate?: number;
  originalPrice?: number;
  originalProfit?: number;
  effectivePrice?: number;
  effectiveProfit?: number;
}

interface Sale {
  id: string;
  items: CartItem[];
  createdBy: string;
  role: string;
  employeeId?: string;
  discount?: number;
  discountType?: "flat" | "percent";
  totalAmount?: number;
  totalProfit?: number;
  date?: any;
  returns?: ReturnRecord[];
  ownerId?: string;
  branchId?: string;
  currency?: string;
  currencySymbol?: string;
}

interface ReturnRecord {
  itemId: string;
  itemName: string;
  quantity: number;
  amount: number;
  profit: number;
  returnedAt: string;
  returnedBy: string;
  returnedByRole: string;
  saleId: string;
  branchId: string;
  ownerId: string;
}

interface CurrencyOption {
  symbol: string;
  code: string;
  name: string;
  flag: string;
}

interface ToastMessage {
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
}

interface OfflineSale {
  ownerId: string | null;
  branchId: string | null;
  createdBy: string;
  role: "owner" | "employee" | undefined;
  items: CartItem[];
  discount: number;
  discountType: "flat" | "percent";
  totalAmount: number;
  totalProfit: number;
  currency: string;
  currencySymbol: string;
  date: string;
  returns: ReturnRecord[];
  employeeId?: string | null;
  localId?: number;
}

export default function Sales() {
  const { activeBranch } = useBranch();

  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReturnProcessing, setIsReturnProcessing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [qty, setQty] = useState("1");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [isScanningInProgress, setIsScanningInProgress] = useState(false);
  
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<"flat" | "percent">("flat");

  const [returnQty, setReturnQty] = useState<{ [key: string]: number }>({});
  const [editingSale, setEditingSale] = useState<string | null>(null);
  const [confirmSale, setConfirmSale] = useState(false);
  const [showRecentSales, setShowRecentSales] = useState(false);

  const [currentUser, setCurrentUser] = useState<{ name: string; role: "owner" | "employee" } | null>(null);
  
  const [currency, setCurrency] = useState<CurrencyOption>({
    symbol: "$",
    code: "USD",
    name: "US Dollar",
    flag: "🇺🇸"
  });

  // Scanner refs
  const initialLoadDone = useRef(false);
  const syncInProgress = useRef(false);
  const scanTimeoutRef = useRef<NodeJS.Timeout>();
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);
  const isProcessingScan = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);

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

  // Helper functions for user-centric structure
  const getProductsCollection = useCallback((userId: string) => {
    return collection(db, "users", userId, "products");
  }, []);

  const getProductDoc = useCallback((userId: string, productId: string) => {
    return doc(db, "users", userId, "products", productId);
  }, []);

  const getSalesCollection = useCallback((userId: string) => {
    return collection(db, "users", userId, "sales");
  }, []);

  const getSaleDoc = useCallback((userId: string, saleId: string) => {
    return doc(db, "users", userId, "sales", saleId);
  }, []);

  // Play beep sound
  const playBeep = useCallback((type: "success" | "error" = "success") => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const audioCtx = audioContextRef.current;
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      if (type === "success") {
        oscillator.frequency.value = 880;
        gainNode.gain.value = 0.3;
        oscillator.start();
        setTimeout(() => {
          oscillator.stop();
          gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.2);
        }, 200);
      } else {
        oscillator.frequency.value = 440;
        gainNode.gain.value = 0.3;
        oscillator.start();
        setTimeout(() => {
          oscillator.stop();
          gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.3);
        }, 300);
      }
    } catch (error) {
      console.log("Audio not supported");
    }
  }, []);

  // Debug logs wrapped
  useEffect(() => {
    if (DEBUG) console.log('Return quantities updated:', returnQty);
  }, [returnQty]);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const showToast = (type: 'success' | 'error' | 'warning' | 'info', title: string, message: string) => {
    setToast({ type, title, message });
  };

  // Debounce search input for product search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  /* ---------------- ONLINE / OFFLINE DETECTION & SYNC ---------------- */
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
      if (!isOffline && ownerId && activeBranch?.id && !syncInProgress.current) {
        syncInProgress.current = true;
        try {
          const offlineSalesJson = localStorage.getItem("offlineSales");
          if (!offlineSalesJson) {
            syncInProgress.current = false;
            return;
          }

          const offlineSales: OfflineSale[] = JSON.parse(offlineSalesJson);
          if (offlineSales.length === 0) {
            syncInProgress.current = false;
            return;
          }

          showToast("info", "Syncing", `Syncing ${offlineSales.length} offline sales...`);

          for (const sale of offlineSales) {
            try {
              const saleData = { ...sale } as any;
              delete saleData.localId;
              saleData.date = serverTimestamp();
              
              const salesRef = getSalesCollection(ownerId);
              await addDoc(salesRef, saleData);
            } catch (err) {
              if (DEBUG) console.error("Error syncing offline sale:", err);
            }
          }

          localStorage.removeItem("offlineSales");
          showToast("success", "Sync Complete", "All offline sales have been synced");
        } catch (err) {
          if (DEBUG) console.error("Error in sync process:", err);
        } finally {
          syncInProgress.current = false;
        }
      }
    };

    syncOfflineSales();
  }, [isOffline, ownerId, activeBranch?.id, getSalesCollection]);

  /* ---------------- LOAD USER CURRENCY ---------------- */
  useEffect(() => {
    const loadUserCurrency = async (userId: string) => {
      try {
        const userDoc = await getDoc(doc(db, "users", userId));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          if (userData.currency) {
            const savedCurrency = currencies.find(c => c.code === userData.currency);
            if (savedCurrency) {
              setCurrency(savedCurrency);
            }
          }
        }
      } catch (error) {
        if (DEBUG) console.error("Error loading currency:", error);
      }
    };

    if (ownerId) {
      loadUserCurrency(ownerId);
    }
  }, [ownerId]);

  // Detect logged user
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      const uid = user.uid;
      let found = false;

      try {
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setOwnerId(uid);
          setCurrentUser({ name: data.username || data.name, role: "owner" });
          found = true;
        }

        if (!found) {
          const empDoc = await getDoc(doc(db, "allEmployees", uid));
          if (empDoc.exists()) {
            const emp = empDoc.data();
            setOwnerId(emp.ownerId);
            setEmployeeId(uid);
            setCurrentUser({ name: emp.name, role: "employee" });
            found = true;
          }
        }
      } catch (error) {
        if (DEBUG) console.error("Error loading user:", error);
      }
      
      setIsLoading(false);
    });

    return () => unsub();
  }, []);

  // Load products from user-centric subcollection
  useEffect(() => {
    if (!activeBranch?.id || !ownerId || isLoading) return;

    // Load from cache instantly
    const cached = localStorage.getItem("products_cache");
    if (cached) {
      try {
        setProducts(JSON.parse(cached));
      } catch (e) {
        if (DEBUG) console.error("Error parsing products cache:", e);
      }
    }

    const productsRef = getProductsCollection(ownerId);
    const q = query(
      productsRef,
      where("branchId", "==", activeBranch.id)
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: Product[] = snap.docs.map((d) => ({
        id: d.id,
        name: d.data().name,
        barcode: d.data().barcode || '',
        qty: d.data().qty,
        saleRate: d.data().saleRate,
        originalSaleRate: d.data().originalSaleRate || d.data().saleRate,
        profit: d.data().profit,
        originalProfit: d.data().originalProfit || d.data().profit,
        purchaseRate: d.data().purchaseRate,
        originalPurchaseRate: d.data().originalPurchaseRate || d.data().purchaseRate,
        allowSale: d.data().allowSale,
      }));
      setProducts(list);
      
      // Update cache
      localStorage.setItem("products_cache", JSON.stringify(list));
    });

    return () => unsub();
  }, [ownerId, activeBranch?.id, isLoading, getProductsCollection]);

  // Load sales from user-centric subcollection
  useEffect(() => {
    if (!activeBranch?.id || !ownerId || isLoading) return;

    if (DEBUG) console.log("Loading sales for owner:", ownerId, "branch:", activeBranch.id);

    const salesRef = getSalesCollection(ownerId);
    const q = query(
      salesRef,
      where("branchId", "==", activeBranch.id),
      orderBy("date", "desc"),
      limit(20)
    );

    const unsub = onSnapshot(q, (snap) => {
      if (DEBUG) console.log("Sales snapshot received, count:", snap.docs.length);
      
      const list: Sale[] = snap.docs
        .map((d) => {
          const data = d.data();
          if (DEBUG) console.log("Sale document:", d.id, data);
          
          return {
            id: d.id,
            items: data.items || [],
            createdBy: data.createdBy || 'Unknown',
            role: data.role || 'unknown',
            employeeId: data.employeeId,
            discount: data.discount || 0,
            discountType: data.discountType || "flat",
            totalAmount: data.totalAmount || 0,
            totalProfit: data.totalProfit || 0,
            date: data.date,
            returns: data.returns || [],
            ownerId: data.ownerId,
            branchId: data.branchId,
          };
        })
        .filter((s) => s.items && s.items.length > 0);

      if (DEBUG) console.log("Processed sales:", list);
      setSales(list);
    }, (error) => {
      if (DEBUG) console.error("Error loading sales:", error);
    });

    return () => unsub();
  }, [ownerId, activeBranch?.id, isLoading, getSalesCollection]);

  // Close camera function
  const closeCamera = useCallback(() => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    setIsCameraActive(false);
    setCameraError("");
    setIsScanningInProgress(false);
    if (scannerContainerRef.current) {
      const videoElement = scannerContainerRef.current.querySelector("video");
      if (videoElement) {
        videoElement.pause();
        videoElement.srcObject = null;
        videoElement.remove();
      }
    }
  }, []);

  // Handle barcode scan result - Auto adds with quantity 1
  const handleBarcodeScan = useCallback(
    (barcode: string) => {
      if (isProcessingScan.current) return;
      isProcessingScan.current = true;
      setIsScanningInProgress(true);

      const product = products.find((p) => p.barcode === barcode);

      if (product) {
        if (product.qty <= 0) {
          playBeep("error");
          showToast("error", "Out of Stock", `${product.name} is out of stock`);
          isProcessingScan.current = false;
          setIsScanningInProgress(false);
          return;
        }

        if (!product.allowSale) {
          playBeep("error");
          showToast("error", "Not for Sale", `${product.name} cannot be sold`);
          isProcessingScan.current = false;
          setIsScanningInProgress(false);
          return;
        }

        playBeep("success");

        setCart((prev) => {
          const existing = prev.find((c) => c.id === product.id);
          if (existing) {
            const newQty = existing.qty + 1;
            if (newQty > product.qty) {
              showToast("warning", "Stock Limit", `Cannot exceed stock: ${product.qty}`);
              return prev;
            }
            showToast("success", "Added", `${product.name} x${existing.qty + 1}`);
            return prev.map((c) => (c.id === product.id ? { ...c, qty: newQty } : c));
          }
          showToast("success", "Added", `${product.name} x1`);
          return [
            ...prev,
            {
              id: product.id,
              name: product.name,
              qty: 1,
              price: product.saleRate,
              profit: product.profit,
              purchaseRate: product.purchaseRate,
              originalPrice: product.saleRate,
              originalProfit: product.profit,
              effectivePrice: product.saleRate,
              effectiveProfit: product.profit,
            },
          ];
        });
      } else {
        playBeep("error");
        showToast("error", "Not Found", `Product with barcode ${barcode} not found`);
        setIsScanningInProgress(false);
      }

      scanTimeoutRef.current = setTimeout(() => {
        isProcessingScan.current = false;
        setIsScanningInProgress(false);
      }, 500);
    },
    [products, playBeep, showToast]
  );

  // Initialize barcode scanner (same as wholesale page)
  useEffect(() => {
    if (!isCameraActive || !scannerContainerRef.current) return;

    const codeReader = new BrowserMultiFormatReader();
    codeReaderRef.current = codeReader;

    const startScanner = async () => {
      try {
        setCameraError("");
        isProcessingScan.current = false;

        if (!scannerContainerRef.current) return;

        const existingVideo = scannerContainerRef.current.querySelector("video");
        if (existingVideo) {
          existingVideo.pause();
          existingVideo.srcObject = null;
          existingVideo.remove();
        }

        const videoElement = document.createElement("video");
        videoElement.setAttribute("autoplay", "");
        videoElement.setAttribute("playsinline", "true");
        videoElement.setAttribute("muted", "true");
        videoElement.style.width = "100%";
        videoElement.style.height = "100%";
        videoElement.style.objectFit = "cover";
        scannerContainerRef.current.appendChild(videoElement);

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((device) => device.kind === "videoinput");

        let selectedDeviceId = null;
        for (const device of videoDevices) {
          if (device.label.toLowerCase().includes("back") || device.label.toLowerCase().includes("rear")) {
            selectedDeviceId = device.deviceId;
            break;
          }
        }

        await codeReader.decodeFromVideoDevice(selectedDeviceId, videoElement, (result, err) => {
          if (result) {
            const barcode = result.getText();
            handleBarcodeScan(barcode);
          }
          if (err && !(err instanceof NotFoundException)) {
            console.error("Scanner error:", err);
          }
        });

        setIsScanningInProgress(false);
      } catch (error) {
        setCameraError("Camera access denied or not available");
        console.error("Camera error:", error);
        setIsCameraActive(false);
      }
    };

    startScanner();

    return () => {
      if (codeReaderRef.current) {
        codeReaderRef.current.reset();
        codeReaderRef.current = null;
      }
    };
  }, [isCameraActive, handleBarcodeScan]);

  // Start camera scanner
  const startCameraScan = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast("error", "Camera Error", "Camera not supported on this device");
      return;
    }

    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }

    setIsCameraActive(true);
    setCameraError("");
  };

  // Enhanced search with barcode support - now works with debouncedSearch
  const searchResults = useMemo(() => {
    if (!debouncedSearch || debouncedSearch.trim() === "") return [];
    const searchLower = debouncedSearch.toLowerCase();
    return products
      .filter(p => 
        p.name.toLowerCase().includes(searchLower) || 
        (p.barcode && p.barcode.includes(debouncedSearch)) ||
        p.id === debouncedSearch
      )
      .filter(p => p.allowSale)
      .slice(0, 10);
  }, [products, debouncedSearch]);

  // Handle product selection from search results
  const handleProductSelect = useCallback((product: Product) => {
    setSelectedProduct(product);
    setSearchTerm(product.name);
    setDebouncedSearch(product.name);
  }, []);

  // Clear search and selected product
  const clearSearch = useCallback(() => {
    setSearchTerm("");
    setDebouncedSearch("");
    setSelectedProduct(null);
  }, []);

  // Memoized calculations
  const totals = useMemo(() => {
    const totalPrice = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
    const totalProfit = cart.reduce((sum, c) => sum + c.profit * c.qty, 0);
    
    let discountAmount = discount;
    if (discountType === "percent") discountAmount = (totalPrice * discount) / 100;

    const maxDiscount = Math.min(totalPrice, totalProfit);
    const validatedDiscountAmount = Math.min(discountAmount, maxDiscount);
    
    return {
      totalPrice,
      totalProfit,
      discountAmount: validatedDiscountAmount,
      finalPrice: totalPrice - validatedDiscountAmount,
      finalProfit: totalProfit - validatedDiscountAmount,
      maxDiscount
    };
  }, [cart, discount, discountType]);

  const addToCart = useCallback(() => {
    const product = selectedProduct || products.find((p) => 
      p.name.toLowerCase() === searchTerm.toLowerCase() ||
      p.barcode === searchTerm ||
      p.id === searchTerm
    );
    
    if (!product) {
      showToast('error', 'Product Not Found', `No product: "${searchTerm}"`);
      return;
    }

    const quantity = Number(qty) || 1;
    if (quantity <= 0) {
      showToast('error', 'Invalid Quantity', 'Please enter a valid quantity');
      return;
    }
    if (quantity > product.qty) {
      showToast('error', 'Insufficient Stock', `Maximum available stock: ${product.qty}`);
      return;
    }
    if (!product.allowSale) {
      showToast('error', 'Product Not Available', 'This product cannot be sold');
      return;
    }
    
    const itemProfit = product.profit * quantity;
    if (itemProfit < 0) {
      showToast('warning', 'Negative Profit', 'This product has negative profit and cannot be sold');
      return;
    }

    setCart((prev) => {
      const existing = prev.find((c) => c.id === product.id);
      if (existing) {
        if (existing.qty + quantity > product.qty) {
          showToast('error', 'Stock Limit', `Cannot exceed stock: ${product.qty}`);
          return prev;
        }
        showToast('success', 'Cart Updated', `${quantity} more ${product.name} added to cart`);
        return prev.map((c) =>
          c.id === product.id ? { ...c, qty: c.qty + quantity } : c
        );
      }
      showToast('success', 'Item Added', `${product.name} added to cart`);
      return [...prev, { 
        id: product.id, 
        name: product.name, 
        qty: quantity, 
        price: product.saleRate,
        profit: product.profit,
        purchaseRate: product.purchaseRate,
        originalPrice: product.saleRate,
        originalProfit: product.profit,
        effectivePrice: product.saleRate,
        effectiveProfit: product.profit,
      }];
    });

    clearSearch();
    setQty("1");
  }, [products, searchTerm, qty, selectedProduct, clearSearch]);

  const removeFromCart = useCallback((id: string) => {
    const item = cart.find(c => c.id === id);
    if (item) {
      showToast('info', 'Item Removed', `${item.name} removed from cart`);
    }
    setCart((prev) => prev.filter((c) => c.id !== id));
  }, [cart]);

  const updateCartQty = useCallback((id: string, newQty: number) => {
    const product = products.find((p) => p.id === id);
    if (!product) return;

    if (newQty <= 0) return removeFromCart(id);
    if (newQty > product.qty) {
      showToast('error', 'Stock Limit', `Maximum available stock: ${product.qty}`);
      return;
    }

    setCart((prev) => prev.map((c) => (c.id === id ? { ...c, qty: newQty } : c)));
  }, [products, removeFromCart]);

  // Complete Sale with offline support (user-centric)
  const makeSale = useCallback(async () => {
    if (cart.length === 0) {
      showToast('error', 'Empty Cart', 'Please add items to cart first');
      return;
    }
    
    if (totals.finalProfit < 0) {
      showToast('error', 'Negative Profit', 'Cannot complete sale: Profit would be negative after discount');
      return;
    }

    setIsProcessing(true);
    setConfirmSale(false);

    try {
      const totalItemsPrice = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
      let discountPerItemRatio = 0;
      
      if (totals.discountAmount > 0 && totalItemsPrice > 0) {
        discountPerItemRatio = totals.discountAmount / totalItemsPrice;
      }
      
      const updatedCartItems = cart.map(item => {
        const itemTotalPrice = item.price * item.qty;
        const itemDiscount = itemTotalPrice * discountPerItemRatio;
        const effectivePrice = item.price - (itemDiscount / item.qty);
        const effectiveProfit = item.profit - (itemDiscount / item.qty);
        
        return {
          ...item,
          effectivePrice: Math.max(0, effectivePrice),
          effectiveProfit: Math.max(0, effectiveProfit),
        };
      });

      if (isOffline) {
        const offlineSalesJson = localStorage.getItem("offlineSales");
        const offlineSales: OfflineSale[] = offlineSalesJson ? JSON.parse(offlineSalesJson) : [];

        const saleData: OfflineSale = {
          ownerId,
          branchId: activeBranch?.id || null,
          createdBy: currentUser?.name || '',
          role: currentUser?.role,
          items: updatedCartItems,
          discount: totals.discountAmount,
          discountType,
          totalAmount: totals.finalPrice,
          totalProfit: totals.finalProfit,
          currency: currency.code,
          currencySymbol: currency.symbol,
          date: new Date().toISOString(),
          returns: [],
          localId: Date.now(),
        };

        if (currentUser?.role === 'employee' && employeeId) {
          saleData.employeeId = employeeId;
        }

        offlineSales.push(saleData);
        localStorage.setItem("offlineSales", JSON.stringify(offlineSales));

        setCart([]);
        setDiscount(0);
        setDiscountType("flat");
        
        showToast('info', 'Saved Offline', 'Sale saved. Will sync when online.');
        setIsProcessing(false);
        return;
      }

      // Update product quantities under user-centric structure
      const updates = cart.map(async (item) => {
        const productRef = getProductDoc(ownerId!, item.id);
        await updateDoc(productRef, { qty: increment(-item.qty) });
      });

      await Promise.all(updates);

      const saleData: any = {
        ownerId,
        branchId: activeBranch?.id,
        createdBy: currentUser?.name,
        role: currentUser?.role,
        items: updatedCartItems,
        discount: totals.discountAmount,
        discountType,
        totalAmount: totals.finalPrice,
        totalProfit: totals.finalProfit,
        currency: currency.code,
        currencySymbol: currency.symbol,
        date: serverTimestamp(),
        returns: [],
      };

      if (currentUser?.role === 'employee' && employeeId) {
        saleData.employeeId = employeeId;
      }

      // Save sale under user-centric subcollection
      const salesRef = getSalesCollection(ownerId!);
      await addDoc(salesRef, saleData);

      setCart([]);
      setDiscount(0);
      setDiscountType("flat");
      
      showToast('success', 'Sale Completed!', `Total amount: ${currency.symbol}${formatCurrency(totals.finalPrice)}`);
    } catch (err) {
      if (DEBUG) console.error(err);
      showToast('error', 'Sale Failed', err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsProcessing(false);
    }
  }, [cart, totals, isOffline, ownerId, activeBranch?.id, currentUser, employeeId, currency, discountType, getProductDoc, getSalesCollection]);

  // Return Item with user-centric structure
  const returnItem = useCallback(async (sale: Sale, item: CartItem) => {
    if (DEBUG) console.log("=== RETURN ATTEMPT START ===");
    
    const user = auth.currentUser;
    if (!user) {
      showToast('error', 'Authentication Error', 'Please log in again');
      return;
    }

    if (!ownerId || !activeBranch?.id) {
      showToast('error', 'Configuration Error', 'Missing owner or branch information');
      return;
    }

    if (!currentUser) {
      showToast('error', 'User Error', 'Could not identify current user');
      return;
    }

    const key = `${sale.id}_${item.id}`;
    const qtyReturn = returnQty[key];
    
    if (!qtyReturn || qtyReturn <= 0) {
      showToast('error', 'Invalid Quantity', 'Please enter a valid return quantity');
      return;
    }
    
    if (qtyReturn > item.qty) {
      showToast('error', 'Exceeds Sold Quantity', `Cannot return more than ${item.qty} items`);
      return;
    }
    
    setIsReturnProcessing(true);

    try {
      await runTransaction(db, async (transaction) => {
        const saleRef = getSaleDoc(ownerId, sale.id);
        const productRef = getProductDoc(ownerId, item.id);
        
        const saleSnap = await transaction.get(saleRef);
        if (!saleSnap.exists()) {
          throw new Error("Sale record not found");
        }
        
        const saleData = saleSnap.data();
        
        if (!saleData.ownerId) {
          throw new Error("Sale record is missing owner information");
        }
        
        if (currentUser?.role === "employee") {
          if (saleData.employeeId !== employeeId) {
            throw new Error("You don't have permission to modify this sale");
          }
        } else if (currentUser?.role === "owner") {
          if (saleData.ownerId !== ownerId) {
            throw new Error("This sale does not belong to your store");
          }
        }
        
        const productSnap = await transaction.get(productRef);
        if (!productSnap.exists()) {
          throw new Error("Product not found in inventory");
        }
        
        const productData = productSnap.data();
        
        if (productData.branchId !== activeBranch.id) {
          throw new Error("Product belongs to a different branch");
        }
        
        const items = [...(saleData.items || [])];
        const itemIndex = items.findIndex((i: any) => i.id === item.id);
        
        if (itemIndex === -1) {
          throw new Error("Item not found in sale");
        }
        
        const originalItem = items[itemIndex];
        const effectivePrice = originalItem.effectivePrice || originalItem.price;
        const effectiveProfit = originalItem.effectiveProfit || originalItem.profit;
        
        const returnAmount = effectivePrice * qtyReturn;
        const returnProfitAmount = effectiveProfit * qtyReturn;
        
        if (originalItem.qty === qtyReturn) {
          items.splice(itemIndex, 1);
        } else {
          items[itemIndex] = {
            ...originalItem,
            qty: originalItem.qty - qtyReturn
          };
        }
        
        const newTotalAmount = (saleData.totalAmount || 0) - returnAmount;
        const newTotalProfit = (saleData.totalProfit || 0) - returnProfitAmount;
        
        transaction.update(productRef, { qty: increment(qtyReturn) });
        
        const returnRecord: ReturnRecord = {
          itemId: item.id,
          itemName: item.name,
          quantity: qtyReturn,
          amount: returnAmount,
          profit: returnProfitAmount,
          returnedAt: new Date().toISOString(),
          returnedBy: currentUser?.name || 'Unknown',
          returnedByRole: currentUser?.role || 'unknown',
          saleId: sale.id,
          branchId: activeBranch.id,
          ownerId: ownerId
        };
        
        const updates: any = {
          items: items,
          totalAmount: newTotalAmount,
          totalProfit: newTotalProfit,
        };
        
        if (saleData.returns) {
          updates.returns = [...saleData.returns, returnRecord];
        } else {
          updates.returns = [returnRecord];
        }
        
        transaction.update(saleRef, updates);
      });
      
      setReturnQty((prev) => {
        const newState = { ...prev };
        delete newState[key];
        return newState;
      });
      
      showToast('success', 'Return Completed', `Successfully returned ${qtyReturn} ${item.name}`);
      
    } catch (err) {
      if (DEBUG) console.error("Return error:", err);
      showToast('error', 'Return Failed', err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsReturnProcessing(false);
    }
  }, [ownerId, activeBranch?.id, currentUser, employeeId, returnQty, getSaleDoc, getProductDoc]);

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

  // Cleanup
  useEffect(() => {
    return () => {
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      if (codeReaderRef.current) {
        codeReaderRef.current.reset();
        codeReaderRef.current = null;
      }
      isProcessingScan.current = false;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-900 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading Sales POS...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 animate-slide-in">
          <div className={`rounded-2xl shadow-2xl p-4 max-w-md backdrop-blur-xl border ${
            toast.type === 'success' ? 'bg-green-50 border-green-200' :
            toast.type === 'error' ? 'bg-red-50 border-red-200' :
            toast.type === 'warning' ? 'bg-orange-50 border-orange-200' :
            'bg-blue-50 border-blue-200'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`text-2xl ${
                toast.type === 'success' ? 'text-green-600' :
                toast.type === 'error' ? 'text-red-600' :
                toast.type === 'warning' ? 'text-orange-600' :
                'text-blue-600'
              }`}>
                {toast.type === 'success' ? '✅' :
                 toast.type === 'error' ? '❌' :
                 toast.type === 'warning' ? '⚠️' : 'ℹ️'}
              </div>
              <div className="flex-1">
                <h3 className={`font-bold ${
                  toast.type === 'success' ? 'text-green-800' :
                  toast.type === 'error' ? 'text-red-800' :
                  toast.type === 'warning' ? 'text-orange-800' :
                  'text-blue-800'
                }`}>{toast.title}</h3>
                <p className={`text-sm mt-1 ${
                  toast.type === 'success' ? 'text-green-600' :
                  toast.type === 'error' ? 'text-red-600' :
                  toast.type === 'warning' ? 'text-orange-600' :
                  'text-blue-600'
                }`}>{toast.message}</p>
              </div>
              <button
                onClick={() => setToast(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Processing Overlay */}
      {(isProcessing || isReturnProcessing) && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl p-8 shadow-2xl text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-900 border-t-transparent mx-auto mb-4"></div>
            <p className="text-lg font-semibold text-gray-900">
              {isProcessing ? 'Processing Sale...' : 'Processing Return...'}
            </p>
            <p className="text-sm text-gray-500 mt-2">Please wait</p>
          </div>
        </div>
      )}

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
                  Sales POS
                </h1>
                <p className="text-sm text-gray-300">
                  {activeBranch?.shopName || "Select Branch"}
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

            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              {currentUser && (
                <div className="flex items-center gap-2 bg-white/10 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/20">
                  <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center font-bold text-white">
                    {getInitials(currentUser.name)}
                  </div>
                  <div className="text-sm">
                    <div className="font-semibold">{currentUser.name}</div>
                    <div className="text-xs text-gray-300 capitalize">{currentUser.role}</div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 bg-white/10 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/20">
                <span className="text-lg">{currency.flag}</span>
                <span className="font-bold">{currency.symbol}</span>
                <span className="text-xs text-gray-300">{currency.code}</span>
              </div>

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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - POS Interface */}
          <div className="space-y-6">
            {/* Scanner Search Card */}
            <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/60 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <div className="p-2 bg-gradient-to-br from-blue-500 to-purple-600 text-white rounded-2xl shadow-lg">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l4 4A1 1 0 006 7h.707l4-4A1 1 0 0010.707 2H6A1 1 0 005.707 2.293zM17 11a1 1 0 01-1 1h-3.707l-4 4A1 1 0 008 18H3a1 1 0 01-.707-1.707l4-4A1 1 0 007 13H3a1 1 0 01-1-1V7a1 1 0 011-1h13a1 1 0 011 1v4z"/>
                  </svg>
                </div>
                Search & Scan
              </h2>
              
              <div className="space-y-4">
                {/* Product Search Input with working name search */}
                <div className="relative">
                  <label className="block text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <span>🔍 Search Product by Name or Barcode</span>
                    {selectedProduct && (
                      <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">
                        Selected: {selectedProduct.name}
                      </span>
                    )}
                  </label>
                  
                  <input
                    type="text"
                    placeholder="Type product name or scan barcode..."
                    className={`w-full px-5 py-4 rounded-2xl border-2 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 outline-none transition-all duration-300 text-lg font-semibold text-gray-900 placeholder-gray-400 ${
                      isScanningInProgress 
                        ? 'border-green-400 bg-green-50 ring-2 ring-green-200/50' 
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setSelectedProduct(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && selectedProduct) {
                        addToCart();
                      }
                    }}
                    autoFocus
                  />
                  
                  {/* Search Results Dropdown - Now shows products by name */}
                  {debouncedSearch && searchResults.length > 0 && !selectedProduct && (
                    <div className="absolute z-50 w-full mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 max-h-80 overflow-y-auto">
                      {searchResults.map(p => (
                        <div
                          key={p.id}
                          className="p-4 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0 transition-all duration-200"
                          onClick={() => handleProductSelect(p)}
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <div className="font-bold text-gray-900 text-lg">{p.name}</div>
                              <div className="text-sm text-gray-500 mt-1 flex flex-wrap gap-2">
                                {p.barcode && <span className="bg-gray-100 px-2 py-0.5 rounded">📦 {p.barcode}</span>}
                                <span>📊 Stock: {p.qty}</span>
                                <span>💰 {currency.symbol}{p.saleRate.toLocaleString()}</span>
                                <span className={p.profit >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  Profit: {currency.symbol}{p.profit.toLocaleString()}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleProductSelect(p);
                                setTimeout(() => addToCart(), 100);
                              }}
                              className="ml-3 px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-bold rounded-lg hover:shadow-lg transition-all"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {debouncedSearch && searchResults.length === 0 && !selectedProduct && (
                    <div className="absolute z-50 w-full mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 text-center text-gray-500">
                      No products found matching "{debouncedSearch}"
                    </div>
                  )}
                </div>

                {/* Quick Quantity Buttons */}
                <div className="grid grid-cols-5 gap-2">
                  {[1,2,3,5,10].map(n => (
                    <button
                      key={n}
                      onClick={() => setQty(n.toString())}
                      className={`p-3 font-bold rounded-xl shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105 text-sm ${
                        Number(qty) === n
                          ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white'
                          : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>

                {/* Mobile Camera Scanner - Same as wholesale page */}
                <div className="grid md:grid-cols-2 gap-3">
                  <button
                    onClick={startCameraScan}
                    disabled={isCameraActive}
                    className={`w-full p-4 rounded-2xl font-bold text-lg shadow-xl transition-all duration-300 flex items-center justify-center gap-3 ${
                      isCameraActive
                        ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white hover:shadow-2xl hover:scale-[1.02]'
                    }`}
                  >
                    {isCameraActive ? (
                      <>
                        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Scanning...
                      </>
                    ) : (
                      <>
                        📷 <span>Scan Barcode</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={addToCart}
                    disabled={!selectedProduct || !qty || isProcessing}
                    className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold py-4 px-6 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:scale-[1.02] text-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                        Processing...
                      </>
                    ) : (
                      `➕ Add ${qty} ${selectedProduct ? selectedProduct.name : 'Product'}`
                    )}
                  </button>
                </div>

                {/* Selected Product Display */}
                {selectedProduct && (
                  <div className="bg-gradient-to-r from-emerald-50 to-green-50 p-4 rounded-2xl border-2 border-emerald-200">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <span className="text-sm font-semibold text-emerald-800">✅ Selected Product</span>
                        <div className="text-lg font-bold text-gray-900">{selectedProduct.name}</div>
                        <div className="text-sm text-gray-600 mt-1">
                          Stock: {selectedProduct.qty} | Rate: {currency.symbol}{selectedProduct.saleRate.toLocaleString()}
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-emerald-700">
                        {currency.symbol}{selectedProduct.saleRate.toLocaleString()}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Cart Section */}
            <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/60 p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-900">Current Cart</h2>
                <span className="bg-gray-900 text-white px-3 py-1 rounded-full text-sm font-semibold">
                  {cart.length} items
                </span>
              </div>

              {cart.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-6xl mb-4">🛒</div>
                  <p className="text-gray-400 font-medium">Cart is empty</p>
                  <p className="text-sm text-gray-400 mt-2">Search for products or scan barcodes to add items!</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                  {cart.map((c) => (
                    <div key={c.id} className="bg-gray-50 p-4 rounded-xl border border-gray-200 hover:border-gray-300 transition-all duration-300">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">{c.name}</div>
                          <div className="text-sm text-gray-600 mt-1">
                            {currency.symbol}{c.price} × {c.qty} = <span className="font-bold text-gray-900">{currency.symbol}{formatCurrency(c.price * c.qty)}</span>
                          </div>
                          <div className="text-xs text-green-600 mt-1">
                            Profit: {currency.symbol}{formatCurrency(c.profit * c.qty)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                          <input
                            type="number"
                            inputMode="numeric"
                            className="w-20 border border-gray-300 rounded-lg text-center p-2 text-lg focus:ring-1 focus:ring-gray-900 outline-none"
                            value={c.qty}
                            onChange={(e) => updateCartQty(c.id, Number(e.target.value))}
                            disabled={isProcessing}
                          />
                          <button
                            onClick={() => removeFromCart(c.id)}
                            disabled={isProcessing}
                            className="bg-red-100 text-red-600 p-2 rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label="Remove item"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Checkout & Summary */}
          <div className="space-y-6">
            <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/60 p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Discount</h2>
              <div className="flex gap-3">
                <select
                  className="w-1/3 px-4 py-3 rounded-xl border border-gray-300 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none transition-all duration-300 text-gray-900 font-semibold bg-white"
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as "flat" | "percent")}
                  disabled={isProcessing}
                >
                  <option value="flat">Flat ({currency.symbol})</option>
                  <option value="percent">%</option>
                </select>

                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  className="flex-1 px-4 py-3 rounded-xl border border-gray-300 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20 outline-none transition-all duration-300 text-gray-900 text-lg font-semibold"
                  value={discount}
                  onChange={(e) => setDiscount(Number(e.target.value))}
                  max={discountType === "flat" ? totals.maxDiscount : 100}
                  disabled={isProcessing}
                />
              </div>
              {discount > 0 && totals.discountAmount < (discountType === "flat" ? discount : (discount * totals.totalPrice / 100)) && (
                <p className="text-xs text-orange-600 mt-2">
                  ⚠️ Discount adjusted to {currency.symbol}{formatCurrency(totals.discountAmount)} to prevent negative profit
                </p>
              )}
            </div>

            <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white rounded-2xl shadow-2xl p-6">
              <h2 className="text-xl font-bold mb-4">Order Summary</h2>
              
              <div className="space-y-3">
                <div className="flex justify-between text-gray-300">
                  <span>Subtotal</span>
                  <span className="font-semibold">{currency.symbol}{formatCurrency(totals.totalPrice)}</span>
                </div>
                
                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-red-400">
                    <span>Discount</span>
                    <span className="font-semibold">-{currency.symbol}{formatCurrency(totals.discountAmount)}</span>
                  </div>
                )}
                
                <div className="flex justify-between text-2xl font-bold pt-4 border-t border-white/20">
                  <span>Total</span>
                  <span className="bg-gradient-to-r from-white to-gray-200 bg-clip-text text-transparent">
                    {currency.symbol}{formatCurrency(totals.finalPrice)}
                  </span>
                </div>
                
                <div className="flex justify-between text-sm pt-2">
                  <span className="text-green-400">Est. Profit</span>
                  <span className={`font-semibold ${totals.finalProfit < 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {currency.symbol}{formatCurrency(totals.finalProfit)}
                  </span>
                </div>

                {totals.finalProfit < 0 && (
                  <div className="text-xs text-red-400 bg-red-400/10 p-2 rounded-lg">
                    ⚠️ Warning: This sale will result in a loss
                  </div>
                )}
              </div>

              <button
                onClick={() => setConfirmSale(true)}
                disabled={cart.length === 0 || totals.finalProfit < 0 || isProcessing}
                className={`w-full mt-6 py-4 rounded-xl font-bold text-lg shadow-xl transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] ${
                  cart.length === 0 || totals.finalProfit < 0 || isProcessing
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white'
                }`}
              >
                {isProcessing ? 'Processing...' : totals.finalProfit < 0 ? 'Cannot Complete (Negative Profit)' : 'Complete Sale'}
              </button>
            </div>

            <button
              onClick={() => setShowRecentSales(!showRecentSales)}
              disabled={isProcessing}
              className="w-full py-4 bg-white/90 backdrop-blur-xl hover:bg-white rounded-xl shadow-xl border border-gray-200/60 text-gray-900 font-semibold transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{showRecentSales ? "📋" : "📜"}</span>
              {showRecentSales ? "Hide Recent Sales" : "Show Recent Sales"}
            </button>
          </div>
        </div>

        {/* Recent Sales Section */}
        {showRecentSales && (
          <div className="mt-8 bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl border border-gray-200/60 p-6 animate-fade-in">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Recent Sales</h2>
            
            {sales.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📊</div>
                <p className="text-gray-400 font-medium">No sales yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sales.map((s) => (
                  <div key={s.id} className="bg-gray-50 rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-all duration-300">
                    <div className="flex justify-between items-start mb-3">
                      <div className="font-semibold text-gray-900">
                        #{s.id.slice(0, 8)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {s.date?.toDate?.().toLocaleString()}
                      </div>
                    </div>

                    <div className="space-y-1 mb-3">
                      {s.items && s.items.length > 0 ? (
                        s.items.map((item, index) => (
                          <div key={`${s.id}-${item.id}-${index}`} className="flex justify-between text-sm text-gray-700">
                            <span>{item.name} x {item.qty}</span>
                            <span className="font-medium">{currency.symbol}{formatCurrency((item.effectivePrice || item.price) * item.qty)}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-gray-400 text-sm">No items</p>
                      )}
                    </div>

                    {s.discount && s.discount > 0 && (
                      <div className="flex justify-between text-sm text-red-500 mb-2">
                        <span>Discount ({s.discountType === "percent" ? "%" : "Flat"})</span>
                        <span>-{s.discountType === "percent" ? `${s.discount}%` : `${currency.symbol}${s.discount}`}</span>
                      </div>
                    )}

                    <div className="flex justify-between text-blue-600 font-bold text-lg mb-2">
                      <span>Total</span>
                      <span>{currency.symbol}{formatCurrency(s.totalAmount || 0)}</span>
                    </div>

                    <div className="flex justify-between mb-3">
                      <span className="text-sm text-gray-600">Profit</span>
                      <span className={`font-semibold ${(s.totalProfit || 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {currency.symbol}{formatCurrency(s.totalProfit || 0)}
                      </span>
                    </div>

                    <div className="text-xs text-gray-400 mb-3">
                      {s.createdBy} ({s.role})
                      {s.employeeId && s.role === 'employee' && (
                        <span className="ml-1 text-blue-500">(Employee)</span>
                      )}
                    </div>

                    <button
                      onClick={() => setEditingSale(editingSale === s.id ? null : s.id)}
                      disabled={isReturnProcessing}
                      className="w-full text-gray-600 text-sm font-semibold py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {editingSale === s.id ? "Close Edit" : "Edit / Return"}
                    </button>

                    {editingSale === s.id && (
                      <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                        {s.items && s.items.map((item, index) => {
                          const key = `${s.id}_${item.id}`;
                          const currentReturnQty = returnQty[key] || '';
                          
                          return (
                            <div key={key} className="flex flex-col sm:flex-row gap-2 items-center bg-white p-2 rounded-lg border border-gray-100">
                              <span className="text-sm font-medium text-gray-700 w-full sm:w-1/2 truncate">
                                {item.name}
                              </span>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={item.qty}
                                value={currentReturnQty}
                                onChange={(e) => {
                                  let val = e.target.value === '' ? 0 : Number(e.target.value);
                                  if (val > item.qty) val = item.qty;
                                  if (val < 0) val = 0;
                                  setReturnQty(prev => ({ 
                                    ...prev, 
                                    [key]: val 
                                  }));
                                }}
                                placeholder={`Max: ${item.qty}`}
                                className="border border-gray-300 rounded-lg p-2 text-center w-full sm:w-24 text-lg focus:ring-1 focus:ring-gray-900 outline-none"
                                disabled={isReturnProcessing}
                              />
                              <button
                                onClick={() => returnItem(s, item)}
                                disabled={isReturnProcessing || !returnQty[key] || returnQty[key] <= 0}
                                className={`px-4 py-2 rounded-lg font-semibold text-sm w-full sm:w-auto transition-colors flex items-center justify-center gap-2 ${
                                  !returnQty[key] || returnQty[key] <= 0 || isReturnProcessing
                                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                    : 'bg-red-600 text-white hover:bg-red-700'
                                }`}
                              >
                                {isReturnProcessing ? (
                                  <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                    <span>Processing...</span>
                                  </>
                                ) : (
                                  'Return'
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Camera Modal - Same as wholesale page */}
      {isCameraActive && (
        <div className="fixed inset-0 bg-black z-[100] flex flex-col">
          <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-4 flex justify-between items-center shadow-lg">
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-bold">📷 Barcode Scanner</h3>
              <p className="text-xs opacity-90">Align barcode in the center</p>
            </div>
            <button
              onClick={closeCamera}
              className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-2xl hover:bg-white/30 active:scale-95 transition-all shrink-0"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 relative bg-black">
            <div ref={scannerContainerRef} className="absolute inset-0 w-full h-full">
              {!cameraError && (
                <div className="absolute inset-0 flex items-center justify-center z-10">
                  <div className="text-white text-sm bg-black/50 px-4 py-2 rounded-full">Loading camera...</div>
                </div>
              )}
            </div>

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-4">
              <div className="w-full max-w-md h-1/3 border-2 border-green-400 rounded-lg shadow-lg relative">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-green-400"></div>
                <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-green-400"></div>
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-green-400"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-green-400"></div>
                <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                  <div className="w-full h-0.5 bg-green-400 animate-scan"></div>
                </div>
              </div>
            </div>

            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/90 px-4">
                <div className="text-center p-6">
                  <div className="text-red-400 text-5xl mb-4">⚠️</div>
                  <p className="text-red-400 font-semibold mb-4">{cameraError}</p>
                  <button
                    onClick={() => {
                      setCameraError("");
                      startCameraScan();
                    }}
                    className="px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-gray-900 p-4">
            <button
              onClick={closeCamera}
              className="w-full py-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold text-base sm:text-lg active:scale-95 transition-all"
            >
              Close Scanner
            </button>
            <p className="text-center text-gray-400 text-xs mt-3">Tap on barcode to focus • Hold steady</p>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmSale && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-gray-900">Complete Sale?</h3>
              <p className="text-sm text-gray-500 mt-2">This action cannot be undone</p>
            </div>
            
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <div className="flex justify-between mb-2">
                <span className="text-gray-600">Total Amount</span>
                <span className="text-2xl font-bold text-gray-900">{currency.symbol}{formatCurrency(totals.finalPrice)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Est. Profit</span>
                <span className={`font-semibold ${totals.finalProfit < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {currency.symbol}{formatCurrency(totals.finalProfit)}
                </span>
              </div>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmSale(false)}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-colors"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmSale(false); makeSale(); }}
                className="flex-1 py-3 rounded-xl bg-gradient-to-r from-gray-900 to-gray-800 text-white font-semibold hover:from-gray-800 hover:to-gray-700 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isProcessing}
              >
                {isProcessing ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }

        @keyframes slide-in-from-bottom {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .animate-in.slide-in-from-bottom-4 {
          animation: slide-in-from-bottom 0.3s ease-out;
        }

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

        @keyframes scan {
          0% {
            transform: translateY(-50%);
          }
          100% {
            transform: translateY(50%);
          }
        }
        
        .animate-scan {
          animation: scan 2s ease-in-out infinite;
        }

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
      `}</style>
    </div>
  );
}