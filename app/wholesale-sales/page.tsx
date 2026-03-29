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
import { useBranch } from "@/context/BranchContext";
import Image from "next/image";
import Link from "next/link";
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';

// Debug mode
const DEBUG = false;

interface Product {
  id: string;
  name: string;
  barcode?: string;
  qty: number;
  saleRate: number;
  allowSale: boolean;
  purchaseRate?: number;
}

interface CartItem {
  id: string;
  name: string;
  qty: number;
  price: number;
  discount?: number;
  discountType?: 'percentage' | 'fixed';
}

interface Customer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  ownerId: string;
  branchId: string;
  isActive: boolean;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  isCredit: boolean;
  paymentStatus: "paid" | "credit";
  paymentMethod: "cash" | "credit";
  notes?: string;
  createdAt: any;
  createdBy: string;
  branchId: string;
  ownerId: string;
}

interface ToastMessage {
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
}

export default function WholesaleSales() {
  const { activeBranch } = useBranch();

  // User state
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [currentUser, setCurrentUser] = useState<{ name: string; role: "owner" | "employee" } | null>(null);

  // Product and cart state
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [qty, setQty] = useState("1");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  
  // Discount state
  const [globalDiscount, setGlobalDiscount] = useState(0);
  const [globalDiscountType, setGlobalDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [itemDiscount, setItemDiscount] = useState<{ [key: string]: { amount: number; type: 'percentage' | 'fixed' } }>({});
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [discountItemId, setDiscountItemId] = useState<string | null>(null);
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  
  // Scanner state
  const [isScanning, setIsScanning] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  
  // Customer state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [customerSearchTerm, setCustomerSearchTerm] = useState("");
  
  // Invoice state
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [createdInvoice, setCreatedInvoice] = useState<Invoice | null>(null);
  const [invoiceNotes, setInvoiceNotes] = useState("");
  const [isCredit, setIsCredit] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [showInvoiceList, setShowInvoiceList] = useState(false);
  const [selectedInvoiceForView, setSelectedInvoiceForView] = useState<Invoice | null>(null);
  const [showEditInvoiceModal, setShowEditInvoiceModal] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  
  // Currency
  const [currency, setCurrency] = useState({ symbol: "₨", code: "PKR" });
  const [shopName, setShopName] = useState("");
  
  // Scanner refs
  const scanTimeoutRef = useRef<NodeJS.Timeout>();
  const codeReaderRef = useRef<BrowserMultiFormatReader>();
  const scannerContainerRef = useRef<HTMLDivElement>(null);
  const isProcessingScan = useRef(false);

  // Show toast
  const showToast = (type: 'success' | 'error' | 'warning' | 'info', title: string, message: string) => {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 3000);
  };

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Load user
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
          setCurrentUser({ name: data.name, role: "owner" });
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

  // Load shop name
  useEffect(() => {
    if (activeBranch?.id && ownerId) {
      const fetchShopName = async () => {
        const branchDoc = await getDoc(doc(db, "branches", activeBranch.id));
        if (branchDoc.exists()) {
          setShopName(branchDoc.data().shopName || "Wholesale Trading");
        }
      };
      fetchShopName();
    }
  }, [activeBranch?.id, ownerId]);

  // Load products
  useEffect(() => {
    if (!activeBranch?.id || !ownerId || isLoading) return;

    const q = query(
      collection(db, "products"),
      where("ownerId", "==", ownerId),
      where("branchId", "==", activeBranch.id),
      where("allowSale", "==", true)
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: Product[] = snap.docs.map((d) => ({
        id: d.id,
        name: d.data().name,
        barcode: d.data().barcode || '',
        qty: d.data().qty,
        saleRate: d.data().saleRate,
        allowSale: d.data().allowSale,
        purchaseRate: d.data().purchaseRate,
      }));
      setProducts(list);
    });

    return () => unsub();
  }, [ownerId, activeBranch?.id, isLoading]);

  // Load customers
  useEffect(() => {
    if (!activeBranch?.id || !ownerId || isLoading) return;

    const q = query(
      collection(db, "customers"),
      where("ownerId", "==", ownerId),
      where("branchId", "==", activeBranch.id),
      where("isActive", "==", true)
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: Customer[] = snap.docs.map((d) => ({
        id: d.id,
        ...d.data()
      } as Customer));
      setCustomers(list);
    });

    return () => unsub();
  }, [ownerId, activeBranch?.id, isLoading]);

  // Load invoices for display
  useEffect(() => {
    if (!activeBranch?.id || !ownerId || isLoading) return;

    const q = query(
      collection(db, "invoices"),
      where("ownerId", "==", ownerId),
      where("branchId", "==", activeBranch.id),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: Invoice[] = snap.docs.map((d) => ({
        id: d.id,
        ...d.data()
      } as Invoice));
      setInvoices(list);
    });

    return () => unsub();
  }, [ownerId, activeBranch?.id, isLoading]);

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
        
        // Create video element for scanner
        let videoElement = scannerContainerRef.current.querySelector('video') as HTMLVideoElement;
        if (!videoElement) {
          videoElement = document.createElement('video');
          scannerContainerRef.current.appendChild(videoElement);
        }
        
        await codeReader.decodeFromVideoDevice(
          null,
          videoElement,
          (result, err) => {
            if (result) {
              const barcode = result.getText();
              handleBarcodeScan(barcode);
              // Don't close camera immediately, allow multiple scans
            }
            if (err && !(err instanceof NotFoundException)) {
              console.error('Scanner error:', err);
            }
          }
        );
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
      }
    };
  }, [isCameraActive]);

  // Handle barcode scan result - AUTO ADD TO CART WITH QTY 1
  const handleBarcodeScan = useCallback((barcode: string) => {
    if (isProcessingScan.current) return;
    isProcessingScan.current = true;

    const product = products.find(p => p.barcode === barcode);
    
    if (product) {
      // Check stock
      if (product.qty <= 0) {
        showToast('error', 'Out of Stock', `${product.name} is out of stock`);
        isProcessingScan.current = false;
        return;
      }
      
      // Auto add to cart with quantity 1
      setCart((prev) => {
        const existing = prev.find((c) => c.id === product.id);
        if (existing) {
          const newQty = existing.qty + 1;
          if (newQty > product.qty) {
            showToast('warning', 'Stock Limit', `Cannot exceed stock: ${product.qty}`);
            return prev;
          }
          showToast('success', 'Added', `${product.name} x${existing.qty + 1}`);
          return prev.map((c) =>
            c.id === product.id ? { ...c, qty: newQty } : c
          );
        }
        showToast('success', 'Added', `${product.name} x1`);
        return [...prev, { 
          id: product.id, 
          name: product.name, 
          qty: 1, 
          price: product.saleRate,
        }];
      });
    } else {
      showToast('error', 'Not Found', `Product with barcode ${barcode} not found`);
    }

    // Reset processing after delay to allow multiple scans
    scanTimeoutRef.current = setTimeout(() => {
      isProcessingScan.current = false;
    }, 500);
  }, [products]);

  // Get next invoice number
  const getNextInvoiceNumber = useCallback(async () => {
    if (!activeBranch?.id || !ownerId) return "INV-001";
    
    try {
      const invoicesRef = collection(db, "invoices");
      const q = query(
        invoicesRef,
        where("ownerId", "==", ownerId),
        where("branchId", "==", activeBranch.id),
        orderBy("createdAt", "desc"),
        limit(1)
      );
      
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
      
      const nextNumber = (lastNumber + 1).toString().padStart(3, '0');
      return `INV-${nextNumber}`;
    } catch (error) {
      console.error("Error getting next invoice number:", error);
      return `INV-${Date.now().toString().slice(-6)}`;
    }
  }, [ownerId, activeBranch?.id]);

  // Search products
  const searchResults = useMemo(() => {
    if (!debouncedSearch) return [];
    const searchLower = debouncedSearch.toLowerCase();
    return products
      .filter(p => 
        p.name.toLowerCase().includes(searchLower) || 
        (p.barcode && p.barcode.includes(debouncedSearch))
      )
      .slice(0, 10);
  }, [products, debouncedSearch]);

  // Filter customers
  const filteredCustomers = useMemo(() => {
    if (!customerSearchTerm) return customers;
    const searchLower = customerSearchTerm.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(searchLower) ||
      (c.phone && c.phone.includes(customerSearchTerm))
    );
  }, [customers, customerSearchTerm]);

  // Calculate totals with discounts
  const totals = useMemo(() => {
    let subtotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
    let totalDiscount = 0;
    
    // Calculate item discounts
    cart.forEach(item => {
      const discount = itemDiscount[item.id];
      if (discount) {
        if (discount.type === 'percentage') {
          totalDiscount += (item.price * item.qty) * (discount.amount / 100);
        } else {
          totalDiscount += discount.amount * item.qty;
        }
      }
    });
    
    // Apply global discount
    let finalTotal = subtotal - totalDiscount;
    if (globalDiscount > 0) {
      if (globalDiscountType === 'percentage') {
        finalTotal = finalTotal * (1 - globalDiscount / 100);
      } else {
        finalTotal = Math.max(0, finalTotal - globalDiscount);
      }
    }
    
    return { 
      subtotal, 
      discount: totalDiscount + (globalDiscountType === 'percentage' ? (subtotal - totalDiscount) * (globalDiscount / 100) : globalDiscount),
      total: Math.max(0, finalTotal) 
    };
  }, [cart, itemDiscount, globalDiscount, globalDiscountType]);

  // Create customer
  const createCustomer = async () => {
    if (!newCustomerName.trim()) {
      showToast('error', 'Required', 'Customer name is required');
      return;
    }

    setIsProcessing(true);
    try {
      const customerData = {
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim() || "",
        isActive: true,
        createdAt: serverTimestamp(),
        ownerId: ownerId!,
        branchId: activeBranch?.id!,
      };
      
      const docRef = await addDoc(collection(db, "customers"), customerData);
      const createdCustomer = { id: docRef.id, ...customerData, ownerId: ownerId!, branchId: activeBranch?.id! } as Customer;
      setCustomers(prev => [...prev, createdCustomer]);
      setSelectedCustomer(createdCustomer);
      setShowCustomerModal(false);
      setShowCreateCustomer(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      showToast('success', 'Customer Created', `${newCustomerName} added`);
    } catch (error) {
      console.error(error);
      showToast('error', 'Error', 'Failed to create customer');
    } finally {
      setIsProcessing(false);
    }
  };

  // Create invoice
  const createInvoice = async () => {
    if (!selectedCustomer) {
      showToast('error', 'No Customer', 'Please select a customer');
      return;
    }

    if (cart.length === 0) {
      showToast('error', 'Empty Cart', 'Please add items to cart');
      return;
    }

    setIsProcessing(true);

    try {
      const invoiceNumber = await getNextInvoiceNumber();
      const { subtotal, discount, total } = totals;
      
      const isCreditSale = isCredit;
      const paymentAmount = isCreditSale ? 0 : total;
      const balance = isCreditSale ? total : 0;

      // Update stock
      const batch = writeBatch(db);
      for (const item of cart) {
        const productRef = doc(db, "products", item.id);
        batch.update(productRef, { qty: increment(-item.qty) });
      }

      // Create invoice
      const invoiceData: any = {
        invoiceNumber,
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        items: cart.map(item => ({
          id: item.id,
          name: item.name,
          qty: item.qty,
          price: item.price,
          discount: itemDiscount[item.id]?.amount || 0,
          discountType: itemDiscount[item.id]?.type || null
        })),
        subtotal,
        discount,
        total,
        paid: paymentAmount,
        balance,
        isCredit: isCreditSale,
        paymentStatus: isCreditSale ? "credit" : "paid",
        paymentMethod: isCreditSale ? "credit" : "cash",
        notes: invoiceNotes || "",
        createdAt: serverTimestamp(),
        createdBy: currentUser?.name || "Unknown",
        branchId: activeBranch?.id!,
        ownerId: ownerId!,
      };

      const invoiceRef = doc(collection(db, "invoices"));
      batch.set(invoiceRef, invoiceData);
      await batch.commit();
      
      const newInvoice: Invoice = { id: invoiceRef.id, ...invoiceData };
      setCreatedInvoice(newInvoice);
      setShowInvoiceModal(true);
      
      // Reset cart and form
      setCart([]);
      setInvoiceNotes("");
      setIsCredit(false);
      setSelectedProduct(null);
      setGlobalDiscount(0);
      setGlobalDiscountType('percentage');
      setItemDiscount({});
      setSearchTerm("");
      
      showToast('success', 'Invoice Created', `Invoice #${invoiceNumber}`);
    } catch (error) {
      console.error("Create invoice error:", error);
      showToast('error', 'Error', 'Failed to create invoice');
    } finally {
      setIsProcessing(false);
    }
  };

  // Update invoice
  const updateInvoice = async () => {
    if (!editingInvoice) return;
    
    setIsProcessing(true);
    try {
      const invoiceRef = doc(db, "invoices", editingInvoice.id);
      await updateDoc(invoiceRef, {
        notes: invoiceNotes || "",
        updatedAt: serverTimestamp(),
      });
      
      // Update local invoices list
      setInvoices(prev => prev.map(inv => 
        inv.id === editingInvoice!.id 
          ? { ...inv, notes: invoiceNotes || "" }
          : inv
      ));
      
      showToast('success', 'Invoice Updated', 'Notes updated successfully');
      setShowEditInvoiceModal(false);
      setEditingInvoice(null);
      setInvoiceNotes("");
    } catch (error) {
      console.error("Update invoice error:", error);
      showToast('error', 'Error', 'Failed to update invoice');
    } finally {
      setIsProcessing(false);
    }
  };

  // Delete invoice
  const deleteInvoice = async (invoiceId: string) => {
    if (!confirm('Are you sure you want to delete this invoice? This action cannot be undone.')) {
      return;
    }
    
    setIsProcessing(true);
    try {
      const invoiceRef = doc(db, "invoices", invoiceId);
      await deleteDoc(invoiceRef);
      
      showToast('success', 'Invoice Deleted', 'Invoice deleted successfully');
    } catch (error) {
      console.error("Delete invoice error:", error);
      showToast('error', 'Error', 'Failed to delete invoice');
    } finally {
      setIsProcessing(false);
    }
  };

  // Add to cart
  const addToCart = useCallback(() => {
    const product = selectedProduct || products.find(p => 
      p.name.toLowerCase() === searchTerm.toLowerCase().trim() ||
      p.barcode === searchTerm.trim()
    );
    
    if (!product) {
      showToast('error', 'Product Not Found', 'Please select a product from search results');
      return;
    }

    const quantity = Math.max(1, Number(qty) || 1);

    if (quantity > product.qty) {
      showToast('error', 'Insufficient Stock', `Only ${product.qty} available`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((c) => c.id === product.id);
      if (existing) {
        const newQty = existing.qty + quantity;
        if (newQty > product.qty) {
          showToast('error', 'Stock Limit', `Cannot exceed stock: ${product.qty}`);
          return prev;
        }
        return prev.map((c) =>
          c.id === product.id ? { ...c, qty: newQty } : c
        );
      }
      return [...prev, { 
        id: product.id, 
        name: product.name, 
        qty: quantity, 
        price: product.saleRate,
      }];
    });

    setSearchTerm("");
    setSelectedProduct(null);
    setQty("1");
    showToast('success', 'Added', `${product.name} x${quantity}`);
  }, [products, searchTerm, qty, selectedProduct]);

  // Remove item from cart
  const removeFromCart = (itemId: string) => {
    setCart(prev => prev.filter(c => c.id !== itemId));
    setItemDiscount(prev => {
      const newDiscounts = { ...prev };
      delete newDiscounts[itemId];
      return newDiscounts;
    });
  };

  // Update cart quantity
  const updateCartQuantity = (itemId: string, newQty: number) => {
    if (newQty <= 0) {
      removeFromCart(itemId);
      return;
    }
    
    const product = products.find(p => p.id === itemId);
    if (product && newQty > product.qty) {
      showToast('error', 'Stock Limit', `Cannot exceed stock: ${product.qty}`);
      return;
    }
    
    setCart(prev => prev.map(c => 
      c.id === itemId ? { ...c, qty: newQty } : c
    ));
  };

  // Add discount to item
  const addItemDiscount = (itemId: string) => {
    const amount = parseFloat(discountAmount);
    if (isNaN(amount) || amount < 0 || amount > 100) {
      showToast('error', 'Invalid Discount', 'Please enter a valid discount (0-100%)');
      return;
    }
    
    setItemDiscount(prev => ({
      ...prev,
      [itemId]: { amount, type: discountType }
    }));
    
    setShowDiscountModal(false);
    setDiscountItemId(null);
    setDiscountAmount("");
    showToast('success', 'Discount Added', `Discount applied to item`);
  };

  // Start camera scanner
  const startCameraScan = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('error', 'Camera Error', 'Camera not supported on this device');
      return;
    }
    
    setIsCameraActive(true);
    setCameraError("");
  };

  // Print invoice
  const printInvoice = (invoice: Invoice) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice ${invoice.invoiceNumber}</title>
        <style>
          body { font-family: 'Courier New', monospace; margin: 0; padding: 20px; background: white; }
          .invoice { max-width: 300px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 1px dashed #000; padding-bottom: 10px; }
          .shop-name { font-size: 20px; font-weight: bold; margin-bottom: 5px; }
          .invoice-title { font-size: 16px; margin: 10px 0; }
          .customer-details { margin: 15px 0; padding: 10px; background: #f9f9f9; border: 1px solid #ddd; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
          th { font-size: 12px; }
          td { font-size: 12px; }
          .totals { text-align: right; margin-top: 15px; padding-top: 10px; border-top: 1px dashed #000; }
          .totals p { margin: 5px 0; font-size: 12px; }
          .balance { color: #f97316; font-weight: bold; }
          .footer { text-align: center; margin-top: 30px; font-size: 10px; }
          @media print { body { padding: 0; } .no-print { display: none; } }
        </style>
      </head>
      <body>
        <div class="invoice">
          <div class="header">
            <div class="shop-name">${shopName || 'Wholesale Trading'}</div>
            <div class="invoice-title">SALE INVOICE</div>
            <div>#: ${invoice.invoiceNumber}</div>
            <div>Date: ${new Date().toLocaleDateString()}</div>
            <div>Time: ${new Date().toLocaleTimeString()}</div>
          </div>
          
          <div class="customer-details">
            <strong>Customer:</strong> ${invoice.customerName}<br/>
          </div>
          
          <table>
            <thead>
              <tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>
            </thead>
            <tbody>
              ${invoice.items.map(item => {
                let itemTotal = item.price * item.qty;
                if (item.discount && item.discount > 0) {
                  if (item.discountType === 'percentage') {
                    itemTotal = itemTotal * (1 - item.discount / 100);
                  } else {
                    itemTotal = itemTotal - item.discount;
                  }
                }
                const discountText = item.discount ? ` (-${item.discount}${item.discountType === 'percentage' ? '%' : ''})` : '';
                return `
                  <tr>
                    <td>${item.name}${discountText}</td>
                    <td style="text-align:center">${item.qty}</td>
                    <td style="text-align:right">${currency.symbol}${item.price.toLocaleString()}</td>
                    <td style="text-align:right">${currency.symbol}${Math.round(itemTotal).toLocaleString()}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          
          <div class="totals">
            <p>Subtotal: ${currency.symbol}${Math.round(invoice.subtotal).toLocaleString()}</p>
            ${invoice.discount > 0 ? `<p>Discount: -${currency.symbol}${Math.round(invoice.discount).toLocaleString()}</p>` : ''}
            <p><strong>Total: ${currency.symbol}${Math.round(invoice.total).toLocaleString()}</strong></p>
            <p>Paid: ${currency.symbol}${Math.round(invoice.paid).toLocaleString()}</p>
            ${invoice.balance > 0 ? `<p class="balance">Balance: ${currency.symbol}${Math.round(invoice.balance).toLocaleString()}</p>` : ''}
            <p>Status: ${invoice.paymentStatus.toUpperCase()}</p>
          </div>
          
          ${invoice.notes ? `<div style="margin-top: 15px;"><strong>Notes:</strong><br/>${invoice.notes}</div>` : ''}
          
          <div class="footer">
            <p>Thank you for your business!</p>
            <p>Powered by Stockaro</p>
          </div>
        </div>
        <div class="no-print" style="text-align:center; margin-top:20px;">
          <button onclick="window.print()" style="padding:10px 20px; margin:0 5px;">Print</button>
          <button onclick="window.close()" style="padding:10px 20px;">Close</button>
        </div>
        <script>window.onload = () => setTimeout(() => window.print(), 500);</script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      if (codeReaderRef.current) {
        codeReaderRef.current.reset();
      }
      isProcessingScan.current = false;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-900 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">Loading Wholesale POS...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Processing Spinner Overlay */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200]">
          <div className="bg-white rounded-2xl p-8 text-center shadow-2xl">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
            <p className="text-gray-700 font-semibold">Processing...</p>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 animate-slide-in">
          <div className={`rounded-xl shadow-lg p-4 max-w-md border ${
            toast.type === 'success' ? 'bg-green-50 border-green-200' :
            toast.type === 'error' ? 'bg-red-50 border-red-200' :
            toast.type === 'warning' ? 'bg-orange-50 border-orange-200' :
            'bg-blue-50 border-blue-200'
          }`}>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="font-semibold">{toast.title}</p>
                <p className="text-sm">{toast.message}</p>
              </div>
              <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-gradient-to-r from-gray-900 to-gray-800 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/owner-dashboard">
                <Image src="/stockaro-logo.png" alt="Logo" width={40} height={40} className="rounded-lg" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Wholesale Sales</h1>
                <p className="text-sm text-gray-300">{shopName || activeBranch?.shopName || 'Select Branch'}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {currentUser && (
                <div className="bg-white/10 px-4 py-2 rounded-lg">
                  <span className="font-semibold">{currentUser.name}</span>
                </div>
              )}
              <div className="bg-white/10 px-3 py-2 rounded-lg">
                <span>{currency.symbol}</span>
              </div>
              <button
                onClick={() => setShowInvoiceList(!showInvoiceList)}
                className="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                disabled={isProcessing}
              >
                📋 Invoices
              </button>
              <Link 
                href="/credit-list"
                className="bg-orange-500 hover:bg-orange-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              >
                💳 Credit List
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Products & Cart */}
          <div className="lg:col-span-2 space-y-6">
            {/* Product Search & Scanner - Combined with button inside search field */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">🔍 Search Products</h2>
              
              <div className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by name or scan barcode..."
                    className={`w-full px-4 py-3 pr-12 rounded-xl border-2 focus:border-blue-500 outline-none transition-all duration-200 ${
                      isScanning ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-gray-400'
                    }`}
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setSelectedProduct(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addToCart();
                      }
                    }}
                    autoFocus
                  />
                  
                  {/* Camera button inside search field */}
                  <button
                    onClick={startCameraScan}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-purple-100 hover:bg-purple-200 rounded-lg transition-all group"
                    title="Scan barcode"
                  >
                    <span className="text-xl">📷</span>
                  </button>
                  
                  {debouncedSearch && searchResults.length > 0 && !selectedProduct && (
                    <div className="absolute z-20 w-full mt-2 bg-white rounded-xl shadow-lg border max-h-64 overflow-y-auto">
                      {searchResults.map(p => (
                        <div
                          key={p.id}
                          className="p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors"
                          onClick={() => {
                            setSelectedProduct(p);
                            setSearchTerm(p.name);
                          }}
                        >
                          <div className="font-semibold text-gray-900">{p.name}</div>
                          {p.barcode && <div className="text-xs text-gray-500 mt-1">Barcode: {p.barcode}</div>}
                          <div className="text-sm text-gray-500 flex gap-3 mt-1">
                            <span>Stock: {p.qty}</span>
                            <span>Price: {currency.symbol}{p.saleRate.toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedProduct && (
                  <div className="bg-blue-50 border-2 border-blue-200 p-4 rounded-xl">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-bold text-lg text-gray-900">{selectedProduct.name}</h3>
                        <p className="text-sm text-gray-600">Stock: {selectedProduct.qty}</p>
                        <p className="text-xl font-bold text-blue-600 mt-1">
                          {currency.symbol}{selectedProduct.saleRate.toLocaleString()}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedProduct(null);
                          setSearchTerm("");
                        }}
                        className="text-gray-400 hover:text-gray-600 text-xl font-bold"
                        title="Clear selection"
                      >
                        ✕
                      </button>
                    </div>
                    
                    <div className="flex gap-3">
                      <input
                        type="number"
                        min="1"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-center focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        placeholder="Qty"
                      />
                      <button
                        onClick={addToCart}
                        disabled={!selectedProduct}
                        className="flex-1 bg-blue-600 disabled:bg-gray-400 text-white py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:cursor-not-allowed transition-all"
                      >
                        ➕ Add to Cart
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Cart */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold flex items-center gap-2">🛒 Cart ({cart.length} items)</h2>
                {cart.length > 0 && (
                  <button
                    onClick={() => setShowDiscountModal(true)}
                    className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                    disabled={cart.length === 0}
                  >
                    💰 Discount
                  </button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <div className="text-6xl mb-4">🛒</div>
                  <p className="text-lg">Cart is empty</p>
                  <p className="text-sm mt-1">Add products to get started</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {cart.map((item, idx) => {
                    const itemDiscountData = itemDiscount[item.id];
                    const itemTotal = item.price * item.qty;
                    let discountedTotal = itemTotal;
                    if (itemDiscountData) {
                      if (itemDiscountData.type === 'percentage') {
                        discountedTotal = itemTotal * (1 - itemDiscountData.amount / 100);
                      } else {
                        discountedTotal = itemTotal - (itemDiscountData.amount * item.qty);
                      }
                    }
                    
                    return (
                      <div key={item.id} className="bg-gray-50 border border-gray-200 p-4 rounded-xl hover:shadow-md transition-all">
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-gray-900 truncate">{item.name}</div>
                            <div className="text-sm text-gray-600 flex flex-wrap gap-2 items-center">
                              <span>{currency.symbol}{item.price.toLocaleString()} × {item.qty}</span>
                              {itemDiscountData && (
                                <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs">
                                  {itemDiscountData.type === 'percentage' 
                                    ? `-${itemDiscountData.amount}%` 
                                    : `-${currency.symbol}${itemDiscountData.amount}`
                                  }
                                </span>
                              )}
                              <span className="text-gray-500 ml-auto">
                                {currency.symbol}{Math.round(discountedTotal).toLocaleString()}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => {
                                setDiscountItemId(item.id);
                                setDiscountAmount(itemDiscountData?.amount?.toString() || "");
                                setDiscountType(itemDiscountData?.type || 'percentage');
                                setShowDiscountModal(true);
                              }}
                              className="text-purple-500 hover:text-purple-700 p-1 hover:bg-purple-100 rounded-lg transition-all"
                              title="Edit discount"
                            >
                              💸
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={item.qty}
                              onChange={(e) => {
                                const newQty = parseInt(e.target.value) || 1;
                                updateCartQuantity(item.id, newQty);
                              }}
                              className="w-16 px-2 py-1 border border-gray-300 rounded-lg text-center focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
                            />
                            <button
                              onClick={() => removeFromCart(item.id)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-100 p-1 rounded-lg transition-all"
                              title="Remove item"
                            >
                              ✕
                            </button>
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
          <div className="space-y-6">
            {/* Customer Selection */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">👤 Customer</h2>
              
              {selectedCustomer ? (
                <div className="bg-green-50 border-2 border-green-200 p-4 rounded-xl">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-bold text-lg text-green-900">{selectedCustomer.name}</div>
                      {selectedCustomer.phone && (
                        <div className="text-sm text-green-700 mt-1">📞 {selectedCustomer.phone}</div>
                      )}
                    </div>
                    <button
                      onClick={() => setSelectedCustomer(null)}
                      className="text-green-600 hover:text-green-800 text-sm font-semibold underline"
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
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">💰 Global Discount</h3>
              <div className="flex gap-3">
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
                  onChange={(e) => setGlobalDiscountType(e.target.value as 'percentage' | 'fixed')}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
                >
                  <option value="percentage">%</option>
                  <option value="fixed">Fixed</option>
                </select>
              </div>
            </div>

            {/* Credit Option */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <label className="flex items-center gap-3 p-3 bg-orange-50 rounded-xl cursor-pointer hover:bg-orange-100 transition-all">
                <input
                  type="checkbox"
                  checked={isCredit}
                  onChange={(e) => setIsCredit(e.target.checked)}
                  className="w-5 h-5 text-orange-600 rounded focus:ring-orange-500"
                />
                <span className="font-semibold text-orange-900">Credit Sale (Pay Later)</span>
              </label>
              {isCredit && (
                <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <p className="text-sm text-orange-800">
                    ⚠️ Customer will owe {currency.symbol}{totals.total.toLocaleString()}
                  </p>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="bg-white rounded-2xl shadow-lg p-6">
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
            <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-2xl shadow-lg p-6">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">💵 Summary</h2>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{currency.symbol}{totals.subtotal.toLocaleString()}</span>
                </div>
                {(Object.keys(itemDiscount).length > 0 || globalDiscount > 0) && (
                  <div className="flex justify-between text-green-400 text-sm">
                    <span>Discount</span>
                    <span>-{currency.symbol}{totals.discount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between pt-4 border-t border-gray-700 text-lg">
                  <span className="font-bold">Total</span>
                  <span className="text-2xl font-bold">{currency.symbol}{Math.round(totals.total).toLocaleString()}</span>
                </div>
              </div>
              
              <button
                onClick={createInvoice}
                disabled={!selectedCustomer || cart.length === 0 || isProcessing}
                className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all transform hover:scale-[1.02] ${
                  !selectedCustomer || cart.length === 0 || isProcessing
                    ? 'bg-gray-600 cursor-not-allowed'
                    : isCredit 
                      ? 'bg-orange-600 hover:bg-orange-700'
                      : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {isProcessing ? (
                  <span className="flex items-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Processing...
                  </span>
                ) : isCredit ? '💳 Create Credit Invoice' : '✅ Create Invoice'}
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Invoice List Modal */}
      {showInvoiceList && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-6 sticky top-0 z-10">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-bold">📋 Recent Invoices</h3>
                <button 
                  onClick={() => setShowInvoiceList(false)} 
                  className="text-3xl hover:scale-110 transition-transform"
                >
                  ✕
                </button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
              {invoices.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <div className="text-6xl mb-4">📄</div>
                  <p className="text-lg">No invoices found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {invoices.slice(0, 20).map(invoice => (
                    <div key={invoice.id} className="border border-gray-200 rounded-xl p-5 hover:shadow-xl hover:border-blue-300 transition-all bg-gradient-to-r from-white to-blue-50">
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div className="flex-1">
                          <p className="font-bold text-xl text-gray-900 mb-1">#{invoice.invoiceNumber}</p>
                          <p className="text-gray-700 font-semibold">{invoice.customerName}</p>
                          <p className="text-sm text-gray-500">
                            {invoice.createdAt?.toDate ? new Date(invoice.createdAt.toDate()).toLocaleDateString() : 'N/A'}
                          </p>
                        </div>
                        <div className="text-right lg:text-left">
                          <p className="text-2xl font-bold text-gray-900">
                            {currency.symbol}{Math.round(invoice.total).toLocaleString()}
                          </p>
                          <p className={`text-sm font-semibold mt-1 px-3 py-1 rounded-full ${
                            invoice.paymentStatus === 'paid' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-orange-100 text-orange-800'
                          }`}>
                            {invoice.paymentStatus === 'paid' ? '✅ Paid' : `⏳ Due ${currency.symbol}${Math.round(invoice.balance).toLocaleString()}`}
                          </p>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <button
                            onClick={() => printInvoice(invoice)}
                            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-semibold transition-all shadow-md"
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
                            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-semibold transition-all shadow-md"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => deleteInvoice(invoice.id)}
                            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-semibold transition-all shadow-md"
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl">
            <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-6 rounded-t-2xl">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-bold">✏️ Edit Invoice</h3>
                <button 
                  onClick={() => {
                    setShowEditInvoiceModal(false);
                    setEditingInvoice(null);
                    setInvoiceNotes("");
                  }} 
                  className="text-3xl hover:scale-110 transition-transform"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-1">Invoice #</p>
                <p className="font-bold text-lg">{editingInvoice.invoiceNumber}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Customer</p>
                <p className="font-semibold">{editingInvoice.customerName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Amount</p>
                <p className="text-xl font-bold text-blue-600">{currency.symbol}{Math.round(editingInvoice.total).toLocaleString()}</p>
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
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowEditInvoiceModal(false);
                    setEditingInvoice(null);
                    setInvoiceNotes("");
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={updateInvoice}
                  disabled={isProcessing}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold transition-all"
                >
                  {isProcessing ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Discount Modal */}
      {showDiscountModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
            <div className="bg-gradient-to-r from-purple-500 to-purple-600 text-white p-6 rounded-t-2xl">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-bold">💰 Apply Discount</h3>
                <button 
                  onClick={() => {
                    setShowDiscountModal(false);
                    setDiscountItemId(null);
                    setDiscountAmount("");
                  }} 
                  className="text-3xl hover:scale-110 transition-transform"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">Discount Type</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDiscountType('percentage')}
                    className={`flex-1 py-2 rounded-lg font-semibold transition-all ${
                      discountType === 'percentage'
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Percentage (%)
                  </button>
                  <button
                    onClick={() => setDiscountType('fixed')}
                    className={`flex-1 py-2 rounded-lg font-semibold transition-all ${
                      discountType === 'fixed'
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Fixed ({currency.symbol})
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">
                  {discountType === 'percentage' ? 'Discount Percentage (%)' : `Discount Amount (${currency.symbol})`}
                </label>
                <input
                  type="number"
                  step={discountType === 'percentage' ? '0.01' : '1'}
                  min="0"
                  max={discountType === 'percentage' ? '100' : undefined}
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                  placeholder={discountType === 'percentage' ? 'e.g., 10' : 'e.g., 500'}
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowDiscountModal(false);
                    setDiscountItemId(null);
                    setDiscountAmount("");
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (discountItemId) {
                      addItemDiscount(discountItemId);
                    } else {
                      // Global discount
                      const amount = parseFloat(discountAmount);
                      if (!isNaN(amount) && amount >= 0) {
                        if (discountType === 'percentage' && amount <= 100) {
                          setGlobalDiscount(amount);
                          setGlobalDiscountType('percentage');
                          setShowDiscountModal(false);
                          setDiscountAmount("");
                          showToast('success', 'Discount Applied', `${amount}% discount applied to all items`);
                        } else if (discountType === 'fixed') {
                          setGlobalDiscount(amount);
                          setGlobalDiscountType('fixed');
                          setShowDiscountModal(false);
                          setDiscountAmount("");
                          showToast('success', 'Discount Applied', `${currency.symbol}${amount} discount applied`);
                        } else {
                          showToast('error', 'Invalid', 'Please enter a valid discount');
                        }
                      } else {
                        showToast('error', 'Invalid', 'Please enter a valid discount');
                      }
                    }
                  }}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-semibold transition-all"
                >
                  Apply Discount
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer Selection Modal */}
      {showCustomerModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-6 sticky top-0 z-10">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-bold">👤 Select Customer</h3>
                <button 
                  onClick={() => {
                    setShowCustomerModal(false);
                    setShowCreateCustomer(false);
                    setCustomerSearchTerm("");
                  }} 
                  className="text-3xl hover:scale-110 transition-transform"
                >
                  ✕
                </button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
              {!showCreateCustomer ? (
                <>
                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="Search by name or phone..."
                      value={customerSearchTerm}
                      onChange={(e) => setCustomerSearchTerm(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      autoFocus
                    />
                  </div>
                  
                  <div className="space-y-2 max-h-96 overflow-y-auto mb-4">
                    {filteredCustomers.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <p>No customers found</p>
                      </div>
                    ) : (
                      filteredCustomers.map(customer => (
                        <div
                          key={customer.id}
                          onClick={() => {
                            setSelectedCustomer(customer);
                            setShowCustomerModal(false);
                            setCustomerSearchTerm("");
                          }}
                          className="p-4 border border-gray-200 rounded-xl hover:bg-blue-50 cursor-pointer transition-all hover:border-blue-300"
                        >
                          <p className="font-semibold text-gray-900">{customer.name}</p>
                          {customer.phone && (
                            <p className="text-sm text-gray-500 mt-1">{customer.phone}</p>
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
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200"
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
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200"
                      placeholder="Phone number (optional)"
                    />
                  </div>
                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={() => {
                        setShowCreateCustomer(false);
                        setNewCustomerName("");
                        setNewCustomerPhone("");
                      }}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-all"
                    >
                      Back
                    </button>
                    <button
                      onClick={createCustomer}
                      disabled={isProcessing}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold transition-all"
                    >
                      {isProcessing ? 'Creating...' : 'Create Customer'}
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-6">
              <div className="flex justify-between items-center">
                <h3 className="text-2xl font-bold">✅ Invoice Created</h3>
                <button 
                  onClick={() => {
                    setShowInvoiceModal(false);
                    setCreatedInvoice(null);
                  }} 
                  className="text-3xl hover:scale-110 transition-transform"
                >
                  ✕
                </button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 text-center">
                <p className="text-lg font-semibold text-green-800">Invoice #{createdInvoice.invoiceNumber}</p>
                <p className="text-sm text-green-700">Total: {currency.symbol}{Math.round(createdInvoice.total).toLocaleString()}</p>
                {createdInvoice.paymentStatus === 'credit' && (
                  <p className="text-sm text-orange-700 mt-1">Credit Sale - Balance Due: {currency.symbol}{Math.round(createdInvoice.balance).toLocaleString()}</p>
                )}
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => printInvoice(createdInvoice)}
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
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full max-h-[80vh] overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-purple-500 to-purple-600 text-white p-5 text-center">
              <h3 className="text-xl font-bold mb-1">📷 Barcode Scanner</h3>
              <p className="text-sm opacity-90">Point camera at barcode</p>
            </div>
            <div className="relative">
              <div 
                ref={scannerContainerRef} 
                className="w-full h-64 bg-black flex items-center justify-center"
              >
                {!cameraError ? (
                  <div className="text-white text-lg">Loading camera...</div>
                ) : (
                  <div className="text-red-400 text-center p-4">
                    <div className="text-4xl mb-2">⚠️</div>
                    <p className="font-semibold">{cameraError}</p>
                  </div>
                )}
              </div>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-48 border-2 border-green-400 border-t-transparent rounded-lg animate-pulse"></div>
              </div>
            </div>
            <div className="p-5 pt-2">
              <button
                onClick={() => {
                  if (codeReaderRef.current) {
                    codeReaderRef.current.reset();
                  }
                  setIsCameraActive(false);
                  setCameraError("");
                }}
                className="w-full py-3 bg-gray-200 hover:bg-gray-300 rounded-xl font-semibold transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}