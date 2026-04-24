"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  orderBy,
  serverTimestamp,
  increment,
  getDoc,
  getDocs,
  writeBatch,
  limit,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import Image from "next/image";
import Link from "next/link";
import { BrowserMultiFormatReader, NotFoundException } from "@zxing/library";
import InvoicePrint from "@/components/InvoicePrint";

// Debug mode
const DEBUG = true;

interface Product {
  id: string;
  name: string;
  barcode?: string;
  qty: number;
  saleRate: number;
  purchaseRate: number;
  allowSale: boolean;
  branchId: string;
  ownerId: string;
}

interface CartItem {
  id: string;
  name: string;
  qty: number;
  price: number;
  regularPrice: number;
  purchaseRate: number;
  isPriceOverridden: boolean;
}

interface Customer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  openingBalance: number;
  totalPurchases?: number;
  isActive: boolean;
  createdAt: any;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  isCredit: boolean;
  paymentStatus: "paid" | "credit" | "partial";
  paymentMethod: "cash" | "credit";
  notes?: string;
  createdAt: any;
  createdBy: string;
  branchId: string;
  ownerId: string;
  totalProfit?: number;
}

interface ToastMessage {
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
}

export default function WholesaleSales() {
  // User state
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [currentUser, setCurrentUser] = useState<{ name: string; role: "owner" | "employee" } | null>(null);
  const [authUser, setAuthUser] = useState<any>(null);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<any>(null);

  // Product and cart state
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [qty, setQty] = useState("1");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Price override modal state
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [priceOverrideProduct, setPriceOverrideProduct] = useState<Product | null>(null);
  const [overridePrice, setOverridePrice] = useState("");
  const [isIncreasingProfit, setIsIncreasingProfit] = useState(true);

  // Print modal state
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [invoiceToPrint, setInvoiceToPrint] = useState<Invoice | null>(null);

  // Global discount state
  const [globalDiscount, setGlobalDiscount] = useState(0);
  const [globalDiscountType, setGlobalDiscountType] = useState<"percentage" | "fixed">("percentage");

  // Scanner state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [isScanningInProgress, setIsScanningInProgress] = useState(false);

  // Customer state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [newCustomerOpeningBalance, setNewCustomerOpeningBalance] = useState("");
  const [customerSearchTerm, setCustomerSearchTerm] = useState("");

  // Invoice state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<Invoice | null>(null);
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [isCredit, setIsCredit] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [showInvoiceList, setShowInvoiceList] = useState(false);
  const [showEditInvoiceModal, setShowEditInvoiceModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);

  // Currency
  const [currency] = useState({ symbol: "₨", code: "PKR" });
  const [branches, setBranches] = useState<any[]>([]);

  // Scanner refs
  const scanTimeoutRef = useRef<NodeJS.Timeout>();
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);
  const isProcessingScan = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Helper functions for user subcollection
  const getUserCollection = useCallback((userId: string, collectionName: string) => {
    return collection(db, "users", userId, collectionName);
  }, []);

  const getUserDoc = useCallback((userId: string, collectionName: string, docId: string) => {
    return doc(db, "users", userId, collectionName, docId);
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

  // Show toast
  const showToast = useCallback((type: ToastMessage["type"], title: string, message: string) => {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Load authenticated user and branches
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (DEBUG) console.log("🔐 Auth state changed:", user?.uid);

      if (!user) {
        setOwnerId(null);
        setAuthUser(null);
        setIsLoading(false);
        return;
      }

      setAuthUser(user);
      setOwnerId(user.uid);

      try {
        const branchesRef = getUserCollection(user.uid, "branches");
        const branchesSnap = await getDocs(branchesRef);
        const branchesList = branchesSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setBranches(branchesList);

        const activeBranchData = branchesList.find((b: any) => b.isActive !== false);
        if (activeBranchData) {
          setActiveBranchId(activeBranchData.id);
          setSelectedBranch(activeBranchData);
        }

        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setCurrentUser({ name: userData.name || "User", role: "owner" });
        }
      } catch (error) {
        console.error("Error loading branches:", error);
      }

      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [getUserCollection]);

  // Load products from USER's subcollection
  useEffect(() => {
    if (!ownerId || !activeBranchId) {
      if (DEBUG) console.log("⏳ Waiting for ownerId or branch...");
      return;
    }

    if (DEBUG) console.log("📡 Loading products for owner:", ownerId, "branch:", activeBranchId);

    const productsRef = getUserCollection(ownerId, "products");
    const q = query(productsRef, where("branchId", "==", activeBranchId), where("allowSale", "==", true), orderBy("name", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (DEBUG) console.log("📊 Products loaded:", snap.size);
        const list: Product[] = snap.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
          barcode: d.data().barcode || "",
          qty: d.data().qty || 0,
          saleRate: d.data().saleRate || 0,
          purchaseRate: d.data().purchaseRate || 0,
          allowSale: d.data().allowSale,
          branchId: d.data().branchId,
          ownerId: d.data().ownerId,
        }));
        setProducts(list);
      },
      (error) => {
        console.error("❌ Error loading products:", error);
        showToast("error", "Error", "Failed to load products");
      }
    );

    return () => unsub();
  }, [ownerId, activeBranchId, getUserCollection, showToast]);

  // Load customers from USER's subcollection
  useEffect(() => {
    if (!ownerId) {
      if (DEBUG) console.log("⏳ Waiting for ownerId for customers...");
      return;
    }

    if (DEBUG) console.log("📡 Loading customers for owner:", ownerId);

    const customersRef = getUserCollection(ownerId, "customers");
    const q = query(customersRef, where("isActive", "==", true), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (DEBUG) console.log("📊 Customers loaded:", snap.size);
        const list: Customer[] = snap.docs.map((d) => ({
          id: d.id,
          name: d.data().name,
          phone: d.data().phone || "",
          address: d.data().address || "",
          openingBalance: d.data().openingBalance || 0,
          totalPurchases: d.data().totalPurchases || 0,
          isActive: d.data().isActive,
          createdAt: d.data().createdAt,
        }));
        setCustomers(list);
      },
      (error) => {
        console.error("❌ Error loading customers:", error);
        showToast("error", "Error", "Failed to load customers");
      }
    );

    return () => unsub();
  }, [ownerId, getUserCollection, showToast]);

  // Load invoices for display
  useEffect(() => {
    if (!ownerId || !activeBranchId) return;

    const invoicesRef = getUserCollection(ownerId, "invoices");
    const q = query(invoicesRef, where("branchId", "==", activeBranchId), orderBy("createdAt", "desc"), limit(50));

    const unsub = onSnapshot(q, (snap) => {
      const list: Invoice[] = snap.docs.map(
        (d) =>
          ({
            id: d.id,
            ...d.data(),
          } as Invoice)
      );
      setInvoices(list);
    });

    return () => unsub();
  }, [ownerId, activeBranchId, getUserCollection]);

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

  // Handle barcode scan result
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
              regularPrice: product.saleRate,
              purchaseRate: product.purchaseRate,
              isPriceOverridden: false,
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

  // Initialize barcode scanner
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

  // Override price for a product (temporary, just for this sale)
  const overrideProductPrice = async () => {
    if (!priceOverrideProduct) return;

    const newPrice = parseFloat(overridePrice);
    if (isNaN(newPrice) || newPrice <= 0) {
      showToast("error", "Invalid Price", "Please enter a valid price");
      return;
    }

    if (newPrice < priceOverrideProduct.purchaseRate) {
      showToast(
        "error",
        "Invalid Price",
        `Price cannot be less than purchase price (${currency.symbol}${priceOverrideProduct.purchaseRate})`
      );
      return;
    }

    const existingItem = cart.find((item) => item.id === priceOverrideProduct.id);

    if (existingItem) {
      setCart((prev) =>
        prev.map((item) =>
          item.id === priceOverrideProduct.id
            ? {
                ...item,
                price: newPrice,
                isPriceOverridden: true,
                regularPrice: item.regularPrice,
              }
            : item
        )
      );

      const profitChange = newPrice - existingItem.regularPrice;
      const profitChangePercent = (profitChange / existingItem.purchaseRate) * 100;

      if (newPrice > existingItem.regularPrice) {
        showToast(
          "success",
          "Price Increased",
          `${priceOverrideProduct.name} price increased by ${currency.symbol}${profitChange} (+${profitChangePercent.toFixed(
            1
          )}% profit)`
        );
      } else if (newPrice < existingItem.regularPrice) {
        showToast(
          "warning",
          "Price Decreased",
          `${priceOverrideProduct.name} price decreased by ${currency.symbol}${Math.abs(profitChange)} (${profitChangePercent.toFixed(
            1
          )}% less profit)`
        );
      } else {
        showToast("info", "Price Reset", `${priceOverrideProduct.name} price reset to regular rate`);
      }
    } else {
      const quantity = Math.max(1, Number(qty) || 1);

      if (quantity > priceOverrideProduct.qty) {
        showToast("error", "Insufficient Stock", `Only ${priceOverrideProduct.qty} available`);
        setShowPriceModal(false);
        setPriceOverrideProduct(null);
        setOverridePrice("");
        return;
      }

      setCart((prev) => [
        ...prev,
        {
          id: priceOverrideProduct.id,
          name: priceOverrideProduct.name,
          qty: quantity,
          price: newPrice,
          regularPrice: priceOverrideProduct.saleRate,
          purchaseRate: priceOverrideProduct.purchaseRate,
          isPriceOverridden: true,
        },
      ]);

      const profitChange = newPrice - priceOverrideProduct.saleRate;
      const profitChangePercent = (profitChange / priceOverrideProduct.purchaseRate) * 100;

      if (newPrice > priceOverrideProduct.saleRate) {
        showToast(
          "success",
          "Added with Higher Price",
          `${priceOverrideProduct.name} x${quantity} at ${currency.symbol}${newPrice} (+${profitChangePercent.toFixed(
            1
          )}% extra profit)`
        );
      } else if (newPrice < priceOverrideProduct.saleRate) {
        showToast(
          "warning",
          "Added with Lower Price",
          `${priceOverrideProduct.name} x${quantity} at ${currency.symbol}${newPrice} (${profitChangePercent.toFixed(
            1
          )}% less profit)`
        );
      } else {
        showToast("success", "Added", `${priceOverrideProduct.name} x${quantity}`);
      }

      setSearchTerm("");
      setSelectedProduct(null);
      setQty("1");
    }

    setShowPriceModal(false);
    setPriceOverrideProduct(null);
    setOverridePrice("");
    setIsIncreasingProfit(true);
  };

  // Get next invoice number
  const getNextInvoiceNumber = useCallback(async () => {
    if (!ownerId || !activeBranchId) return "INV-001";

    try {
      const invoicesRef = getUserCollection(ownerId, "invoices");
      const q = query(invoicesRef, where("branchId", "==", activeBranchId), orderBy("createdAt", "desc"), limit(1));

      const querySnapshot = await getDocs(q);
      let lastNumber = 0;

      if (!querySnapshot.empty) {
        const lastInvoice = querySnapshot.docs[0].data();
        const lastInvoiceNumber = lastInvoice.invoiceNumber;
        const match = lastInvoiceNumber.match(/\d+$/);
        if (match) {
          lastNumber = parseInt(match[0]);
        }
      }

      const nextNumber = (lastNumber + 1).toString().padStart(3, "0");
      return `INV-${nextNumber}`;
    } catch (error) {
      console.error("Error getting next invoice number:", error);
      return `INV-${Date.now().toString().slice(-6)}`;
    }
  }, [ownerId, activeBranchId, getUserCollection]);

  // Search products
  const searchResults = useMemo(() => {
    if (!debouncedSearch) return [];
    const searchLower = debouncedSearch.toLowerCase();
    return products
      .filter((p) => p.name.toLowerCase().includes(searchLower) || (p.barcode && p.barcode.includes(debouncedSearch)))
      .slice(0, 10);
  }, [products, debouncedSearch]);

  // Filter customers
  const filteredCustomers = useMemo(() => {
    if (!customerSearchTerm) return customers;
    const searchLower = customerSearchTerm.toLowerCase();
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(searchLower) ||
        (c.phone && c.phone.includes(customerSearchTerm)) ||
        (c.address && c.address.toLowerCase().includes(searchLower))
    );
  }, [customers, customerSearchTerm]);

  // Calculate totals
  const totals = useMemo(() => {
    let subtotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
    let totalDiscount = 0;

    let finalTotal = subtotal;
    if (globalDiscount > 0) {
      if (globalDiscountType === "percentage") {
        finalTotal = finalTotal * (1 - globalDiscount / 100);
        totalDiscount = subtotal - finalTotal;
      } else {
        finalTotal = Math.max(0, finalTotal - globalDiscount);
        totalDiscount = globalDiscount;
      }
    }

    return {
      subtotal,
      discount: totalDiscount,
      total: Math.max(0, finalTotal),
    };
  }, [cart, globalDiscount, globalDiscountType]);

  // Calculate total profit
  const totalProfit = useMemo(() => {
    return cart.reduce((sum, item) => {
      const profit = (item.price - item.purchaseRate) * item.qty;
      return sum + profit;
    }, 0);
  }, [cart]);

  // Create customer with address and opening balance
  const createCustomer = async () => {
    if (!newCustomerName.trim()) {
      showToast("error", "Required", "Customer name is required");
      return;
    }

    if (!ownerId) {
      showToast("error", "Error", "User not authenticated");
      return;
    }

    setIsProcessing(true);
    try {
      const customersRef = getUserCollection(ownerId, "customers");
      const openingBalance = parseFloat(newCustomerOpeningBalance) || 0;

      const customerData = {
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim() || "",
        address: newCustomerAddress.trim() || "",
        openingBalance: openingBalance,
        totalPurchases: 0,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(customersRef, customerData);
      const createdCustomer = { id: docRef.id, ...customerData } as Customer;
      setCustomers((prev) => [createdCustomer, ...prev]);
      setSelectedCustomer(createdCustomer);
      setShowCustomerModal(false);
      setShowCreateCustomer(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      setNewCustomerAddress("");
      setNewCustomerOpeningBalance("");

      if (openingBalance !== 0) {
        showToast("success", "Customer Created", `${newCustomerName} added with opening balance ${currency.symbol}${openingBalance}`);
      } else {
        showToast("success", "Customer Created", `${newCustomerName} added`);
      }
    } catch (error) {
      console.error(error);
      showToast("error", "Error", "Failed to create customer");
    } finally {
      setIsProcessing(false);
    }
  };

  // Edit price of item in cart (temporary override)
  const editCartItemPrice = (itemId: string, currentPrice: number, regularPrice: number, purchaseRate: number) => {
    const newPrice = prompt(
      `Enter new sale price for this item (Min: ${currency.symbol}${purchaseRate}, Regular: ${currency.symbol}${regularPrice}):`,
      currentPrice.toString()
    );
    if (newPrice !== null) {
      const priceNum = parseFloat(newPrice);
      if (!isNaN(priceNum) && priceNum > 0) {
        if (priceNum < purchaseRate) {
          showToast("error", "Invalid Price", `Price cannot be less than purchase price (${currency.symbol}${purchaseRate})`);
          return;
        }

        setCart((prev) =>
          prev.map((item) =>
            item.id === itemId
              ? {
                  ...item,
                  price: priceNum,
                  isPriceOverridden: priceNum !== regularPrice,
                }
              : item
          )
        );

        const profitChange = priceNum - regularPrice;
        if (profitChange > 0) {
          showToast("success", "Price Increased", `Item price increased by ${currency.symbol}${profitChange}`);
        } else if (profitChange < 0) {
          showToast("warning", "Price Decreased", `Item price decreased by ${currency.symbol}${Math.abs(profitChange)}`);
        } else {
          showToast("info", "Price Reset", `Item price reset to regular rate`);
        }
      } else {
        showToast("error", "Invalid", "Please enter a valid price");
      }
    }
  };

  // Reset item price to regular price
  const resetCartItemPrice = (itemId: string, regularPrice: number) => {
    setCart((prev) => prev.map((item) => (item.id === itemId ? { ...item, price: regularPrice, isPriceOverridden: false } : item)));
    showToast("info", "Price Reset", `Price reset to regular ${currency.symbol}${regularPrice}`);
  };

  // Create invoice - ALL INVOICES START AS UNPAID
  const createInvoice = async () => {
    if (!selectedCustomer) {
      showToast("error", "No Customer", "Please select a customer");
      return;
    }

    if (cart.length === 0) {
      showToast("error", "Empty Cart", "Please add items to cart");
      return;
    }

    if (!ownerId || !activeBranchId) {
      showToast("error", "Error", "Missing branch or user info");
      return;
    }

    setIsProcessing(true);

    try {
      const invoiceNumber = await getNextInvoiceNumber();
      const { subtotal, discount, total } = totals;

      // All invoices start with ZERO paid - full amount is due
      const paymentAmount = 0;
      const balance = total;

      const batch = writeBatch(db);

      for (const item of cart) {
        const productRef = getUserDoc(ownerId, "products", item.id);
        batch.update(productRef, { qty: increment(-item.qty) });
      }

      const invoicesRef = getUserCollection(ownerId, "invoices");
      const invoiceData = {
        invoiceNumber,
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        customerPhone: selectedCustomer.phone || "",
        customerAddress: selectedCustomer.address || "",
        items: cart.map((item) => ({
          id: item.id,
          name: item.name,
          qty: item.qty,
          price: item.price,
          regularPrice: item.regularPrice,
          purchaseRate: item.purchaseRate,
          isPriceOverridden: item.isPriceOverridden,
        })),
        subtotal,
        discount,
        total,
        paid: paymentAmount,
        balance: balance,
        totalProfit: totalProfit,
        isCredit: true,
        paymentStatus: "credit" as "credit",
        paymentMethod: "credit" as "credit",
        notes: invoiceNotes || "",
        createdAt: serverTimestamp(),
        createdBy: currentUser?.name || "Unknown",
        branchId: activeBranchId,
        ownerId: ownerId,
      };

      const invoiceRef = doc(invoicesRef);
      batch.set(invoiceRef, invoiceData);

      // Add ledger entry
      const ledgerRef = getUserCollection(ownerId, "ledger");
      batch.set(doc(ledgerRef), {
        partyId: selectedCustomer.id,
        partyName: selectedCustomer.name,
        type: "credit_sale",
        amount: balance,
        invoiceId: invoiceRef.id,
        invoiceNumber,
        branchId: activeBranchId,
        date: serverTimestamp(),
        note: `Invoice #${invoiceNumber} created - Total: ${currency.symbol}${total.toLocaleString()}`,
      });

      await batch.commit();

      const newInvoice: Invoice = {
        id: invoiceRef.id,
        ...invoiceData,
        createdAt: new Date(),
      } as Invoice;
      setCreatedInvoice(newInvoice);
      setShowInvoiceModal(true);

      // Reset form
      setCart([]);
      setInvoiceNotes("");
      setIsCredit(false);
      setSelectedProduct(null);
      setGlobalDiscount(0);
      setGlobalDiscountType("percentage");
      setSearchTerm("");

      showToast(
        "success",
        "Invoice Created",
        `Invoice #${invoiceNumber} | Total: ${currency.symbol}${total.toLocaleString()} | Status: UNPAID | Profit: ${currency.symbol}${totalProfit.toLocaleString()}`
      );
    } catch (error) {
      console.error("Create invoice error:", error);
      showToast("error", "Error", "Failed to create invoice");
    } finally {
      setIsProcessing(false);
    }
  };

  // Update invoice
  const updateInvoice = async () => {
    if (!editingInvoice || !ownerId) return;

    setIsProcessing(true);
    try {
      const invoiceRef = getUserDoc(ownerId, "invoices", editingInvoice.id);
      await updateDoc(invoiceRef, {
        notes: invoiceNotes || "",
        updatedAt: serverTimestamp(),
      });

      showToast("success", "Invoice Updated", "Notes updated successfully");
      setShowEditInvoiceModal(false);
      setEditingInvoice(null);
      setInvoiceNotes("");
    } catch (error) {
      console.error("Update invoice error:", error);
      showToast("error", "Error", "Failed to update invoice");
    } finally {
      setIsProcessing(false);
    }
  };

  // Delete invoice
  const deleteInvoice = async (invoiceId: string) => {
    if (!confirm("Are you sure you want to delete this invoice? This action cannot be undone.")) {
      return;
    }

    if (!ownerId) return;

    setIsProcessing(true);
    try {
      const invoiceRef = getUserDoc(ownerId, "invoices", invoiceId);
      const invoiceDoc = await getDoc(invoiceRef);

      if (invoiceDoc.exists()) {
        const invoiceData = invoiceDoc.data();
        const batch = writeBatch(db);

        // Restore stock for each item
        for (const item of invoiceData.items || []) {
          const productRef = getUserDoc(ownerId, "products", item.id);
          batch.update(productRef, { qty: increment(item.qty) });
        }

        batch.delete(invoiceRef);
        await batch.commit();
      } else {
        await deleteDoc(invoiceRef);
      }

      showToast("success", "Invoice Deleted", "Invoice deleted successfully");
    } catch (error) {
      console.error("Delete invoice error:", error);
      showToast("error", "Error", "Failed to delete invoice");
    } finally {
      setIsProcessing(false);
    }
  };

  // Add to cart with regular price
  const addToCart = useCallback(() => {
    const product =
      selectedProduct ||
      products.find((p) => p.name.toLowerCase() === searchTerm.toLowerCase().trim() || p.barcode === searchTerm.trim());

    if (!product) {
      showToast("error", "Product Not Found", "Please select a product from search results");
      return;
    }

    const quantity = Math.max(1, Number(qty) || 1);

    if (quantity > product.qty) {
      showToast("error", "Insufficient Stock", `Only ${product.qty} available`);
      return;
    }

    const existingItem = cart.find((item) => item.id === product.id);

    if (existingItem) {
      const newQty = existingItem.qty + quantity;
      if (newQty > product.qty) {
        showToast("error", "Stock Limit", `Cannot exceed stock: ${product.qty}`);
        return;
      }
      setCart((prev) => prev.map((item) => (item.id === product.id ? { ...item, qty: newQty } : item)));
      showToast("success", "Added", `${product.name} x${existingItem.qty + quantity}`);
    } else {
      setCart((prev) => [
        ...prev,
        {
          id: product.id,
          name: product.name,
          qty: quantity,
          price: product.saleRate,
          regularPrice: product.saleRate,
          purchaseRate: product.purchaseRate,
          isPriceOverridden: false,
        },
      ]);
      showToast("success", "Added", `${product.name} x${quantity} at ${currency.symbol}${product.saleRate}`);
    }

    setSearchTerm("");
    setSelectedProduct(null);
    setQty("1");
  }, [products, searchTerm, qty, selectedProduct, showToast, cart, currency.symbol]);

  // Remove item from cart
  const removeFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((c) => c.id !== itemId));
  };

  // Update cart quantity
  const updateCartQuantity = (itemId: string, newQty: number) => {
    if (newQty <= 0) {
      removeFromCart(itemId);
      return;
    }

    const product = products.find((p) => p.id === itemId);
    if (product && newQty > product.qty) {
      showToast("error", "Stock Limit", `Cannot exceed stock: ${product.qty}`);
      return;
    }

    setCart((prev) => prev.map((c) => (c.id === itemId ? { ...c, qty: newQty } : c)));
  };

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

  // Print invoice
  const handlePrintInvoice = (invoice: Invoice) => {
    const enrichedInvoice = {
      ...invoice,
      customerPhone: invoice.customerPhone || selectedCustomer?.phone || "",
      customerAddress: invoice.customerAddress || selectedCustomer?.address || "",
      totalProfit: invoice.totalProfit || totalProfit,
    };

    setInvoiceToPrint(enrichedInvoice);
    setShowPrintModal(true);
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
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-14 w-14 sm:h-16 sm:w-16 border-4 border-gray-900 border-t-transparent mx-auto mb-4"></div>
          <p className="text-sm sm:text-base text-gray-600">Loading Wholesale POS...</p>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md w-full mx-auto p-6 sm:p-8">
          <div className="text-5xl sm:text-6xl mb-4">🔐</div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Authentication Required</h2>
          <p className="text-sm sm:text-base text-gray-600 mb-6">Please log in to access the POS system.</p>
          <Link
            href="/login"
            className="inline-block w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold transition-all"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Processing Spinner Overlay */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200] px-4">
          <div className="bg-white rounded-2xl p-6 sm:p-8 text-center shadow-2xl w-full max-w-sm">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
            <p className="text-gray-700 font-semibold">Processing...</p>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-3 right-3 left-3 sm:left-auto sm:top-4 sm:right-4 z-50 animate-slide-in">
          <div
            className={`rounded-xl shadow-lg p-4 w-full sm:max-w-md border ${
              toast.type === "success"
                ? "bg-green-50 border-green-200"
                : toast.type === "error"
                ? "bg-red-50 border-red-200"
                : toast.type === "warning"
                ? "bg-orange-50 border-orange-200"
                : "bg-blue-50 border-blue-200"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-semibold break-words">{toast.title}</p>
                <p className="text-sm break-words">{toast.message}</p>
              </div>
              <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-600 shrink-0">
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-gradient-to-r from-gray-900 to-gray-800 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/owner-dashboard" className="shrink-0">
                <Image
                  src="/stockaro-logo.png"
                  alt="Logo"
                  width={40}
                  height={40}
                  className="rounded-lg cursor-pointer hover:opacity-80 transition-opacity w-10 h-10"
                />
              </Link>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold truncate">Wholesale Sales</h1>
                <p className="text-xs sm:text-sm text-gray-300 truncate">{selectedBranch?.shopName || "Select Branch"}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 xl:flex items-stretch xl:items-center gap-2 sm:gap-3">
              <Link
                href="/owner-dashboard"
                className="bg-purple-500 hover:bg-purple-600 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2"
              >
                <span>📊</span> Dashboard
              </Link>

              {branches.length > 0 && (
                <select
                  value={activeBranchId || ""}
                  onChange={(e) => {
                    const branchId = e.target.value;
                    setActiveBranchId(branchId);
                    const branch = branches.find((b) => b.id === branchId);
                    setSelectedBranch(branch);
                    setProducts([]);
                    setCart([]);
                    setSelectedCustomer(null);
                  }}
                  className="col-span-2 sm:col-span-3 xl:col-span-1 xl:min-w-[220px] bg-white/10 border border-white/20 rounded-xl px-3 sm:px-4 py-2 text-white text-xs sm:text-sm focus:outline-none"
                  disabled={isLoading}
                >
                  <option value="" className="text-gray-900">
                    Select Branch
                  </option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id} className="text-gray-900">
                      {branch.shopName}
                    </option>
                  ))}
                </select>
              )}

              {currentUser && (
                <div className="bg-white/10 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm flex items-center justify-center text-center break-words">
                  <span className="font-semibold truncate">{currentUser.name}</span>
                </div>
              )}

              <div className="bg-white/10 px-3 py-2 rounded-lg text-xs sm:text-sm flex items-center justify-center">
                <span>{currency.symbol}</span>
              </div>

              <Link
                href="/invoice-management"
                className="bg-blue-500 hover:bg-blue-600 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all inline-flex items-center justify-center gap-2"
              >
                📋 Invoices
              </Link>

              <Link
                href="/credit-list"
                className="bg-orange-500 hover:bg-orange-600 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center text-center"
              >
                💳 Credit List
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8 pb-28 lg:pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Left Column - Products & Cart */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            {/* Product Search & Scanner */}
            <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6">
              <h2 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2">🔍 Search Products</h2>

              <div className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by name or scan barcode..."
                    className={`w-full px-4 py-3 pr-14 text-sm sm:text-base rounded-xl border-2 focus:border-blue-500 outline-none transition-all duration-200 ${
                      isScanningInProgress ? "border-green-400 bg-green-50" : "border-gray-300 hover:border-gray-400"
                    }`}
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setSelectedProduct(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addToCart();
                      }
                    }}
                    autoFocus
                  />

                  <button
                    onClick={startCameraScan}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all group ${
                      isScanningInProgress ? "bg-green-500 animate-pulse" : "bg-purple-100 hover:bg-purple-200"
                    }`}
                    title="Scan barcode"
                    disabled={isScanningInProgress}
                  >
                    <span className="text-xl">{isScanningInProgress ? "⏳" : "📷"}</span>
                  </button>

                  {debouncedSearch && searchResults.length > 0 && !selectedProduct && (
                    <div className="absolute z-20 w-full mt-2 bg-white rounded-xl shadow-lg border max-h-72 overflow-y-auto">
                      {searchResults.map((p) => (
                        <div
                          key={p.id}
                          className="p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors"
                          onClick={() => {
                            setSelectedProduct(p);
                            setSearchTerm(p.name);
                          }}
                        >
                          <div className="font-semibold text-gray-900 text-sm sm:text-base break-words">{p.name}</div>
                          {p.barcode && <div className="text-xs text-gray-500 mt-1 break-all">Barcode: {p.barcode}</div>}
                          <div className="text-xs sm:text-sm text-gray-500 flex flex-col sm:flex-row sm:flex-wrap gap-1 sm:gap-3 mt-1">
                            <span>Stock: {p.qty}</span>
                            <span>
                              Regular: {currency.symbol}
                              {p.saleRate.toLocaleString()}
                            </span>
                            <span className="text-gray-400">
                              Cost: {currency.symbol}
                              {p.purchaseRate.toLocaleString()}
                            </span>
                          </div>
                          <div className="text-xs text-green-600 mt-1">
                            Profit: {currency.symbol}
                            {(p.saleRate - p.purchaseRate).toLocaleString()} (
                            {((p.saleRate - p.purchaseRate) / p.purchaseRate * 100).toFixed(1)}%)
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setPriceOverrideProduct(p);
                              setOverridePrice(p.saleRate.toString());
                              setShowPriceModal(true);
                            }}
                            className="mt-2 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 px-2 py-1 rounded-lg transition-colors"
                          >
                            💰 Override Price
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedProduct && (
                  <div className="bg-blue-50 border-2 border-blue-200 p-4 rounded-xl">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-3">
                      <div className="min-w-0">
                        <h3 className="font-bold text-base sm:text-lg text-gray-900 break-words">{selectedProduct.name}</h3>
                        <p className="text-sm text-gray-600">Stock: {selectedProduct.qty}</p>
                        <p className="text-lg sm:text-xl font-bold text-blue-600 mt-1">
                          {currency.symbol}
                          {selectedProduct.saleRate.toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-500">
                          Purchase: {currency.symbol}
                          {selectedProduct.purchaseRate.toLocaleString()}
                        </p>
                        <p className="text-xs text-green-600">
                          Profit: {currency.symbol}
                          {(selectedProduct.saleRate - selectedProduct.purchaseRate).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex gap-3 sm:gap-2 items-center justify-between sm:justify-end">
                        <button
                          onClick={() => {
                            setPriceOverrideProduct(selectedProduct);
                            setOverridePrice(selectedProduct.saleRate.toString());
                            setShowPriceModal(true);
                          }}
                          className="text-purple-600 hover:text-purple-800 text-sm font-semibold underline"
                        >
                          Override Price
                        </button>
                        <button
                          onClick={() => {
                            setSelectedProduct(null);
                            setSearchTerm("");
                          }}
                          className="text-gray-400 hover:text-gray-600 text-xl font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="number"
                        min="1"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        className="w-full sm:w-24 px-3 py-2 border border-gray-300 rounded-lg text-center focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                      <button
                        onClick={addToCart}
                        disabled={!selectedProduct}
                        className="flex-1 bg-blue-600 disabled:bg-gray-400 text-white py-2.5 rounded-lg font-semibold hover:bg-blue-700 disabled:cursor-not-allowed transition-all"
                      >
                        ➕ Add to Cart
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Cart */}
            <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-6">
                <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">🛒 Cart ({cart.length} items)</h2>
                {cart.length > 0 && (
                  <div className="text-sm font-semibold text-green-600">
                    Total Profit: {currency.symbol}
                    {totalProfit.toLocaleString()}
                  </div>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="text-center py-10 sm:py-12 text-gray-400">
                  <div className="text-5xl sm:text-6xl mb-4">🛒</div>
                  <p className="text-base sm:text-lg">Cart is empty</p>
                  <p className="text-sm mt-1">Add products to get started</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[60vh] lg:max-h-96 overflow-y-auto pr-1">
                  {cart.map((item) => {
                    const itemTotal = item.price * item.qty;
                    const profit = (item.price - item.purchaseRate) * item.qty;
                    const profitPercent = ((item.price - item.purchaseRate) / item.purchaseRate) * 100;
                    const isOverridden = item.isPriceOverridden;

                    return (
                      <div
                        key={item.id}
                        className={`border p-3 sm:p-4 rounded-xl hover:shadow-md transition-all ${
                          isOverridden ? "bg-purple-50 border-purple-200" : "bg-gray-50 border-gray-200"
                        }`}
                      >
                        <div className="flex flex-col gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900 break-words flex flex-wrap items-center gap-2">
                              {item.name}
                              {isOverridden && (
                                <span className="text-[10px] sm:text-xs bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full">
                                  Price Adjusted
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-600 flex flex-col sm:flex-row sm:flex-wrap gap-1 sm:gap-2 items-start sm:items-center mt-1">
                              <span>
                                {currency.symbol}
                                {item.price.toLocaleString()} × {item.qty}
                              </span>
                              {isOverridden && (
                                <span className="text-xs text-gray-400 line-through">
                                  (Regular: {currency.symbol}
                                  {item.regularPrice.toLocaleString()})
                                </span>
                              )}
                              <span className="text-gray-500 sm:ml-auto font-medium">
                                = {currency.symbol}
                                {Math.round(itemTotal).toLocaleString()}
                              </span>
                            </div>
                            <div className={`text-xs mt-1 ${profit > 0 ? "text-green-600" : "text-red-600"}`}>
                              Profit: {currency.symbol}
                              {profit.toLocaleString()} ({profitPercent.toFixed(1)}%)
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => editCartItemPrice(item.id, item.price, item.regularPrice, item.purchaseRate)}
                                className="text-purple-500 hover:text-purple-700 p-2 hover:bg-purple-100 rounded-lg transition-all"
                                title="Override price"
                              >
                                💰
                              </button>
                              {isOverridden && (
                                <button
                                  onClick={() => resetCartItemPrice(item.id, item.regularPrice)}
                                  className="text-blue-500 hover:text-blue-700 p-2 hover:bg-blue-100 rounded-lg transition-all"
                                  title="Reset to regular price"
                                >
                                  🔄
                                </button>
                              )}
                            </div>

                            <div className="flex items-center gap-2 ml-auto sm:ml-0">
                              <input
                                type="number"
                                min="1"
                                value={item.qty}
                                onChange={(e) => {
                                  const newQty = parseInt(e.target.value) || 1;
                                  updateCartQuantity(item.id, newQty);
                                }}
                                className="w-20 sm:w-16 px-2 py-2 border border-gray-300 rounded-lg text-center focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
                              />
                              <button
                                onClick={() => removeFromCart(item.id)}
                                className="text-red-500 hover:text-red-700 hover:bg-red-100 p-2 rounded-lg transition-all"
                                title="Remove item"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Customer & Checkout */}
          <div className="space-y-4 sm:space-y-6">
            {/* Customer Selection */}
            <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6">
              <h2 className="text-lg sm:text-xl font-bold mb-4 flex items-center gap-2">👤 Customer</h2>

              {selectedCustomer ? (
                <div className="bg-green-50 border-2 border-green-200 p-4 rounded-xl">
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <div className="font-bold text-base sm:text-lg text-green-900 break-words">{selectedCustomer.name}</div>
                      {selectedCustomer.phone && <div className="text-sm text-green-700 mt-1 break-all">📞 {selectedCustomer.phone}</div>}
                      {selectedCustomer.address && <div className="text-sm text-green-700 mt-1 break-words">📍 {selectedCustomer.address}</div>}
                      {selectedCustomer.openingBalance !== 0 && (
                        <div className="text-sm text-orange-600 mt-1">
                          Opening Balance: {currency.symbol}
                          {selectedCustomer.openingBalance.toLocaleString()}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setSelectedCustomer(null)}
                      className="text-green-600 hover:text-green-800 text-sm font-semibold underline shrink-0"
                    >
                      Change
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCustomerModal(true)}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all shadow-lg"
                  disabled={isProcessing}
                >
                  + Select Customer
                </button>
              )}
            </div>

            {/* Global Discount */}
            <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">💰 Global Discount</h3>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={globalDiscount}
                  onChange={(e) => setGlobalDiscount(parseFloat(e.target.value) || 0)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
                  placeholder="0"
                />
                <select
                  value={globalDiscountType}
                  onChange={(e) => setGlobalDiscountType(e.target.value as "percentage" | "fixed")}
                  className="w-full sm:w-32 px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
                >
                  <option value="percentage">%</option>
                  <option value="fixed">Fixed</option>
                </select>
              </div>
            </div>

            {/* Credit Option - Visual only, all invoices are credit by default */}
            <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6">
              <div className="p-3 bg-blue-50 rounded-xl">
                <p className="text-sm text-blue-800">
                  ℹ️ All invoices are created as CREDIT (Unpaid). You can add payments later in Invoice Management.
                </p>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6">
              <h3 className="font-semibold mb-3 flex items-center gap-2">📝 Notes</h3>
              <textarea
                placeholder="Order notes (optional)"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-vertical focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
                value={invoiceNotes}
                onChange={(e) => setInvoiceNotes(e.target.value)}
              />
            </div>

            {/* Order Summary */}
            <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-2xl shadow-lg p-4 sm:p-6 lg:sticky lg:top-24">
              <h2 className="text-lg sm:text-xl font-bold mb-6 flex items-center gap-2">💵 Summary</h2>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-sm gap-3">
                  <span>Subtotal</span>
                  <span className="text-right break-all">
                    {currency.symbol}
                    {totals.subtotal.toLocaleString()}
                  </span>
                </div>
                {totals.discount > 0 && (
                  <div className="flex justify-between text-green-400 text-sm gap-3">
                    <span>Discount</span>
                    <span className="text-right break-all">
                      -{currency.symbol}
                      {totals.discount.toLocaleString()}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-start pt-4 border-t border-gray-700 text-lg gap-3">
                  <span className="font-bold">Total</span>
                  <span className="text-xl sm:text-2xl font-bold text-right break-all">
                    {currency.symbol}
                    {Math.round(totals.total).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-green-400 text-sm pt-2 gap-3">
                  <span>Total Profit</span>
                  <span className="font-semibold text-right break-all">
                    +{currency.symbol}
                    {totalProfit.toLocaleString()}
                  </span>
                </div>
              </div>

              <button
                onClick={createInvoice}
                disabled={!selectedCustomer || cart.length === 0 || isProcessing || !activeBranchId}
                className="w-full py-4 rounded-xl font-bold text-base sm:text-lg shadow-lg transition-all transform hover:scale-[1.02] bg-orange-600 hover:bg-orange-700 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {isProcessing ? (
                  <span className="flex items-center gap-2 justify-center">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Processing...
                  </span>
                ) : (
                  "📝 Create Invoice (Unpaid)"
                )}
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Price Override Modal */}
      {showPriceModal && priceOverrideProduct && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-md w-full shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-purple-500 to-purple-600 text-white p-4 sm:p-6 rounded-t-2xl">
              <div className="flex justify-between items-center gap-3">
                <h3 className="text-xl sm:text-2xl font-bold">💰 Override Sale Price</h3>
                <button
                  onClick={() => {
                    setShowPriceModal(false);
                    setPriceOverrideProduct(null);
                    setOverridePrice("");
                  }}
                  className="text-3xl hover:scale-110 transition-transform shrink-0"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-1">Product</p>
                <p className="font-bold text-lg break-words">{priceOverrideProduct.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Purchase Price (Your Cost)</p>
                <p className="font-semibold text-orange-600">
                  {currency.symbol}
                  {priceOverrideProduct.purchaseRate.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Regular Sale Price</p>
                <p className="font-semibold text-blue-600">
                  {currency.symbol}
                  {priceOverrideProduct.saleRate.toLocaleString()}
                </p>
                <p className="text-xs text-green-600">
                  Regular Profit: {currency.symbol}
                  {(priceOverrideProduct.saleRate - priceOverrideProduct.purchaseRate).toLocaleString()}
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Override Price ({currency.symbol})</label>
                <input
                  type="number"
                  step="1"
                  min={priceOverrideProduct.purchaseRate}
                  value={overridePrice}
                  onChange={(e) => {
                    setOverridePrice(e.target.value);
                    const newPrice = parseFloat(e.target.value);
                    if (!isNaN(newPrice)) {
                      setIsIncreasingProfit(newPrice > priceOverrideProduct.saleRate);
                    }
                  }}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                  placeholder="Enter sale price"
                  autoFocus
                />
                {overridePrice && !isNaN(parseFloat(overridePrice)) && (
                  <div
                    className={`mt-2 text-sm ${
                      parseFloat(overridePrice) > priceOverrideProduct.saleRate
                        ? "text-green-600"
                        : parseFloat(overridePrice) < priceOverrideProduct.saleRate
                        ? "text-orange-600"
                        : "text-gray-500"
                    }`}
                  >
                    {parseFloat(overridePrice) > priceOverrideProduct.saleRate ? (
                      <>
                        ⬆️ Profit increase: +{currency.symbol}
                        {(parseFloat(overridePrice) - priceOverrideProduct.saleRate).toLocaleString()}
                      </>
                    ) : parseFloat(overridePrice) < priceOverrideProduct.saleRate ? (
                      <>
                        ⬇️ Profit decrease: -{currency.symbol}
                        {(priceOverrideProduct.saleRate - parseFloat(overridePrice)).toLocaleString()}
                      </>
                    ) : (
                      <>➡️ Regular price (no change)</>
                    )}
                  </div>
                )}
                <p className="text-xs text-red-500 mt-2">
                  ⚠️ Cannot go below purchase price ({currency.symbol}
                  {priceOverrideProduct.purchaseRate})
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowPriceModal(false);
                    setPriceOverrideProduct(null);
                    setOverridePrice("");
                  }}
                  className="flex-1 px-4 py-3 sm:py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={overrideProductPrice}
                  disabled={isProcessing}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-3 sm:py-2 rounded-lg font-semibold transition-all"
                >
                  Apply Override
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invoice List Modal */}
      {showInvoiceList && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-4xl w-full max-h-[95vh] overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-4 sm:p-6 sticky top-0 z-10">
              <div className="flex justify-between items-center gap-3">
                <h3 className="text-xl sm:text-2xl font-bold">📋 Recent Invoices</h3>
                <button onClick={() => setShowInvoiceList(false)} className="text-3xl hover:scale-110 transition-transform shrink-0">
                  ✕
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(95vh-100px)]">
              {invoices.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <div className="text-6xl mb-4">📄</div>
                  <p className="text-lg">No invoices found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {invoices.slice(0, 20).map((invoice) => (
                    <div
                      key={invoice.id}
                      className="border border-gray-200 rounded-xl p-4 sm:p-5 hover:shadow-xl hover:border-blue-300 transition-all bg-gradient-to-r from-white to-blue-50"
                    >
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-lg sm:text-xl text-gray-900 mb-1 break-words">#{invoice.invoiceNumber}</p>
                            <p className="text-gray-700 font-semibold break-words">{invoice.customerName}</p>
                            <p className="text-sm text-gray-500">
                              {invoice.createdAt?.toDate ? new Date(invoice.createdAt.toDate()).toLocaleDateString() : "N/A"}
                            </p>
                          </div>
                          <div className="text-left lg:text-right min-w-0">
                            <p className="text-xl sm:text-2xl font-bold text-gray-900 break-all">
                              {currency.symbol}
                              {Math.round(invoice.total).toLocaleString()}
                            </p>
                            <p
                              className={`text-xs sm:text-sm font-semibold mt-1 px-3 py-1 rounded-full inline-block ${
                                invoice.paymentStatus === "paid"
                                  ? "bg-green-100 text-green-800"
                                  : invoice.paymentStatus === "partial"
                                  ? "bg-yellow-100 text-yellow-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {invoice.paymentStatus === "paid"
                                ? "✅ Paid"
                                : invoice.paymentStatus === "partial"
                                ? `💰 Partial (${currency.symbol}${Math.round(invoice.paid).toLocaleString()} paid)`
                                : `⚠️ Unpaid (${currency.symbol}${Math.round(invoice.balance).toLocaleString()} due)`}
                            </p>
                            {invoice.totalProfit && (
                              <p className="text-xs text-green-600 mt-1">
                                Profit: {currency.symbol}
                                {Math.round(invoice.totalProfit).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <button
                            onClick={() => handlePrintInvoice(invoice)}
                            className="px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-semibold transition-all shadow-md"
                          >
                            🖨️ Print
                          </button>
                          <button
                            onClick={() => {
                              setEditingInvoice(invoice);
                              setInvoiceNotes(invoice.notes || "");
                              setShowEditInvoiceModal(true);
                              setShowInvoiceList(false);
                            }}
                            className="px-4 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-semibold transition-all shadow-md"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => deleteInvoice(invoice.id)}
                            className="px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-semibold transition-all shadow-md"
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Invoice Modal */}
      {showEditInvoiceModal && editingInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-lg w-full shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-4 sm:p-6 rounded-t-2xl">
              <div className="flex justify-between items-center gap-3">
                <h3 className="text-xl sm:text-2xl font-bold">✏️ Edit Invoice</h3>
                <button
                  onClick={() => {
                    setShowEditInvoiceModal(false);
                    setEditingInvoice(null);
                    setInvoiceNotes("");
                  }}
                  className="text-3xl hover:scale-110 transition-transform shrink-0"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-1">Invoice #</p>
                <p className="font-bold text-lg break-words">{editingInvoice.invoiceNumber}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Customer</p>
                <p className="font-semibold break-words">{editingInvoice.customerName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Amount</p>
                <p className="text-xl font-bold text-blue-600 break-all">
                  {currency.symbol}
                  {Math.round(editingInvoice.total).toLocaleString()}
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">Notes</label>
                <textarea
                  value={invoiceNotes}
                  onChange={(e) => setInvoiceNotes(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-200"
                  placeholder="Add notes..."
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowEditInvoiceModal(false);
                    setEditingInvoice(null);
                    setInvoiceNotes("");
                  }}
                  className="flex-1 px-4 py-3 sm:py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={updateInvoice}
                  disabled={isProcessing}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-3 sm:py-2 rounded-lg font-semibold transition-all"
                >
                  {isProcessing ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer Selection Modal */}
      {showCustomerModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-lg w-full max-h-[95vh] overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-4 sm:p-6 sticky top-0 z-10">
              <div className="flex justify-between items-center gap-3">
                <h3 className="text-xl sm:text-2xl font-bold">👤 Select Customer</h3>
                <button
                  onClick={() => {
                    setShowCustomerModal(false);
                    setShowCreateCustomer(false);
                    setCustomerSearchTerm("");
                  }}
                  className="text-3xl hover:scale-110 transition-transform shrink-0"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(95vh-100px)]">
              {!showCreateCustomer ? (
                <>
                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="Search by name, phone or address..."
                      value={customerSearchTerm}
                      onChange={(e) => setCustomerSearchTerm(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      autoFocus
                    />
                  </div>

                  <div className="space-y-2 max-h-[50vh] overflow-y-auto mb-4 pr-1">
                    {filteredCustomers.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <p>No customers found</p>
                        <p className="text-sm mt-1">Click "Create New Customer" to add one</p>
                      </div>
                    ) : (
                      filteredCustomers.map((customer) => (
                        <div
                          key={customer.id}
                          onClick={() => {
                            setSelectedCustomer(customer);
                            setShowCustomerModal(false);
                            setCustomerSearchTerm("");
                            showToast("success", "Customer Selected", customer.name);
                          }}
                          className="p-4 border border-gray-200 rounded-xl hover:bg-blue-50 cursor-pointer transition-all hover:border-blue-300"
                        >
                          <p className="font-semibold text-gray-900 break-words">{customer.name}</p>
                          {customer.phone && <p className="text-sm text-gray-500 mt-1 break-all">📞 {customer.phone}</p>}
                          {customer.address && <p className="text-sm text-gray-500 mt-1 break-words">📍 {customer.address}</p>}
                          {customer.openingBalance !== 0 && (
                            <p className="text-xs text-orange-600 mt-1">
                              Opening Balance: {currency.symbol}
                              {customer.openingBalance.toLocaleString()}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  <button
                    onClick={() => setShowCreateCustomer(true)}
                    className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold transition-all"
                  >
                    + Create New Customer
                  </button>
                </>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2">Name *</label>
                    <input
                      type="text"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      className="w-full px-4 py-3 sm:py-2 border border-gray-300 rounded-lg focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200"
                      placeholder="Customer name"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">Phone</label>
                    <input
                      type="tel"
                      value={newCustomerPhone}
                      onChange={(e) => setNewCustomerPhone(e.target.value)}
                      className="w-full px-4 py-3 sm:py-2 border border-gray-300 rounded-lg focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200"
                      placeholder="Phone number (optional)"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">Address</label>
                    <textarea
                      value={newCustomerAddress}
                      onChange={(e) => setNewCustomerAddress(e.target.value)}
                      rows={2}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200 resize-vertical"
                      placeholder="Customer address (optional)"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">Opening Balance ({currency.symbol})</label>
                    <input
                      type="number"
                      step="1"
                      value={newCustomerOpeningBalance}
                      onChange={(e) => setNewCustomerOpeningBalance(e.target.value)}
                      className="w-full px-4 py-3 sm:py-2 border border-gray-300 rounded-lg focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200"
                      placeholder="0"
                    />
                    <p className="text-xs text-gray-500 mt-1">Positive amount means customer owes you money</p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 pt-4">
                    <button
                      onClick={() => {
                        setShowCreateCustomer(false);
                        setNewCustomerName("");
                        setNewCustomerPhone("");
                        setNewCustomerAddress("");
                        setNewCustomerOpeningBalance("");
                      }}
                      className="flex-1 px-4 py-3 sm:py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-all"
                    >
                      Back
                    </button>
                    <button
                      onClick={createCustomer}
                      disabled={isProcessing}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-3 sm:py-2 rounded-lg font-semibold transition-all"
                    >
                      {isProcessing ? "Creating..." : "Create Customer"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Invoice Success Modal */}
      {showInvoiceModal && createdInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-2xl w-full max-h-[95vh] overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-4 sm:p-6">
              <div className="flex justify-between items-center gap-3">
                <h3 className="text-xl sm:text-2xl font-bold">✅ Invoice Created</h3>
                <button
                  onClick={() => {
                    setShowInvoiceModal(false);
                    setCreatedInvoice(null);
                  }}
                  className="text-3xl hover:scale-110 transition-transform shrink-0"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto max-h-[calc(95vh-100px)]">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 text-center">
                <p className="text-lg font-semibold text-green-800 break-words">Invoice #{createdInvoice.invoiceNumber}</p>
                <p className="text-sm text-green-700 break-all">
                  Total: {currency.symbol}
                  {Math.round(createdInvoice.total).toLocaleString()}
                </p>
                <p className="text-sm text-green-700 mt-1 break-all">
                  Total Profit: {currency.symbol}
                  {Math.round(createdInvoice.totalProfit || totalProfit).toLocaleString()}
                </p>
                <p className="text-sm text-orange-700 mt-1 font-semibold break-all">
                  ⚠️ Status: UNPAID - Balance Due: {currency.symbol}
                  {Math.round(createdInvoice.balance).toLocaleString()}
                </p>
                <p className="text-xs text-gray-600 mt-2">💡 You can add payment in Invoice Management page</p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => handlePrintInvoice(createdInvoice)}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl font-semibold transition-all"
                >
                  🖨️ Print Invoice
                </button>
                <button
                  onClick={() => {
                    setShowInvoiceModal(false);
                    setCreatedInvoice(null);
                  }}
                  className="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-3 rounded-xl font-semibold transition-all"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Camera Modal */}
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

      {/* Invoice Print Modal */}
      {showPrintModal && invoiceToPrint && (
        <InvoicePrint
          invoice={invoiceToPrint}
          shopName={selectedBranch?.shopName || "Wholesale Trading"}
          currency={currency}
          onClose={() => {
            setShowPrintModal(false);
            setInvoiceToPrint(null);
          }}
        />
      )}

      <style jsx>{`
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
        @keyframes scan {
          0% {
            transform: translateY(-50%);
          }
          100% {
            transform: translateY(50%);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
        .animate-scan {
          animation: scan 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}