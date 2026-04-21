"use client";

import { useState, useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
  increment,
  addDoc,
  runTransaction,
  deleteDoc,
} from "firebase/firestore";
import Link from "next/link";
import { useBranch } from "@/context/BranchContext";
import InvoicePrint from "@/components/InvoicePrint";

interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  branchId?: string;
  items: any[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  isCredit: boolean;
  paymentStatus: "paid" | "credit" | "partial";
  paymentMethod: "cash" | "credit";
  status?: "pending" | "delivered";
  isDelivered?: boolean;
  deliveredAt?: any;
  notes?: string;
  createdAt: any;
  totalProfit?: number;
}

interface ToastMessage {
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
  purchasePrice?: number;
  stock?: number;
  category?: string;
}

export default function InvoiceManagementPage() {
  const { activeBranch } = useBranch();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showDeliveryConfirm, setShowDeliveryConfirm] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [currency] = useState({ symbol: "₨", code: "PKR" });
  const [filter, setFilter] = useState<"all" | "pending" | "delivered">("all");
  const [currentUser, setCurrentUser] = useState<{ name: string; role: "owner" | "employee" } | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [invoiceToPrint, setInvoiceToPrint] = useState<any>(null);
  
  // Edit invoice state
  const [editingItems, setEditingItems] = useState<any[]>([]);
  const [editingDiscount, setEditingDiscount] = useState(0);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const showToast = (type: ToastMessage['type'], title: string, message: string) => {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 3000);
  };

  // Helper function to get user subcollection
  const getUserCollection = (userId: string, collectionName: string) => {
    return collection(db, "users", userId, collectionName);
  };

  // Load user
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setIsLoading(false);
        return;
      }
      setOwnerId(user.uid);
      
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setCurrentUser({ name: data.username || data.name || "Owner", role: "owner" });
        } else {
          const empDoc = await getDoc(doc(db, "allEmployees", user.uid));
          if (empDoc.exists()) {
            const emp = empDoc.data();
            setCurrentUser({ name: emp.name || "Employee", role: "employee" });
          }
        }
      } catch (error) {
        console.error("Error loading user:", error);
      }
      
      setIsLoading(false);
    });
    return () => unsub();
  }, []);

  // Load products for editing - FIXED PATH
  useEffect(() => {
    if (!ownerId || !showEditModal) return;

    console.log("Loading products for owner:", ownerId);
    
    // Use the correct path for products
    const productsRef = getUserCollection(ownerId, "products");
    const q = query(productsRef, where("isActive", "==", true));
    
    const unsub = onSnapshot(q, (snap) => {
      console.log("Products loaded:", snap.size);
      const list: Product[] = snap.docs.map((d) => ({
        id: d.id,
        name: d.data().name,
        price: d.data().price || 0,
        purchasePrice: d.data().purchasePrice || d.data().cost || d.data().purchaseRate || 0,
        stock: d.data().stock || d.data().currentStock || 0,
        category: d.data().category,
      }));
      setAvailableProducts(list);
    }, (error) => {
      console.error("Error loading products:", error);
    });
    
    return () => unsub();
  }, [ownerId, showEditModal]);

  // Load invoices
  useEffect(() => {
    if (!ownerId || !activeBranch?.id) return;

    const invoicesRef = getUserCollection(ownerId, "invoices");
    const q = query(
      invoicesRef,
      where("branchId", "==", activeBranch.id),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: Invoice[] = snap.docs.map((d) => {
        const data = d.data();
        const total = data.total || 0;
        const paid = data.paid || 0;
        const balance = data.balance !== undefined ? data.balance : total - paid;
        
        let paymentStatus = data.paymentStatus;
        if (!paymentStatus || paymentStatus === "credit") {
          if (balance === 0 && paid === total && total > 0) {
            paymentStatus = "paid";
          } else if (paid > 0 && balance > 0) {
            paymentStatus = "partial";
          } else if (balance > 0 && paid === 0) {
            paymentStatus = "credit";
          }
        }
        
        return {
          id: d.id,
          ...data,
          total: total,
          paid: paid,
          balance: balance,
          paymentStatus: paymentStatus,
          status: data.status || (data.isDelivered ? "delivered" : "pending"),
          isDelivered: data.isDelivered || false,
          isCredit: paymentStatus === "credit" || (balance > 0 && paid === 0),
        } as Invoice;
      });
      setInvoices(list);
    }, (error) => {
      console.error("Error loading invoices:", error);
    });

    return () => unsub();
  }, [ownerId, activeBranch?.id]);

  const filteredInvoices = invoices.filter(inv => {
    if (filter === "all") return true;
    if (filter === "pending") return inv.status !== "delivered";
    if (filter === "delivered") return inv.status === "delivered";
    return true;
  });

  // Calculate profit for items
  const calculateItemProfit = (item: any) => {
    if (item.profit) return item.profit;
    if (item.effectiveProfit) return item.effectiveProfit;
    const purchaseRate = item.purchaseRate || item.purchasePrice || (item.price * 0.7);
    return (item.price - purchaseRate) * item.qty;
  };

  // Calculate total profit for invoice
  const calculateTotalProfit = (invoice: Invoice) => {
    if (invoice.totalProfit) return invoice.totalProfit;
    return invoice.items.reduce((sum, item) => sum + calculateItemProfit(item), 0);
  };

  // Update stock when editing invoice (before delivery)
  const updateStockForEdit = async (oldItems: any[], newItems: any[]) => {
    if (!ownerId) return;
    
    const batch = writeBatch(db);
    const stockChanges: { [key: string]: number } = {};
    
    // Calculate stock changes
    oldItems.forEach((item) => {
      const newItem = newItems.find(i => i.id === item.id);
      if (newItem) {
        const diff = newItem.qty - item.qty;
        if (diff !== 0) {
          stockChanges[item.id] = (stockChanges[item.id] || 0) - diff;
        }
      } else {
        stockChanges[item.id] = (stockChanges[item.id] || 0) + item.qty;
      }
    });
    
    newItems.forEach((newItem) => {
      const oldItem = oldItems.find(i => i.id === newItem.id);
      if (!oldItem) {
        stockChanges[newItem.id] = (stockChanges[newItem.id] || 0) - newItem.qty;
      }
    });
    
    // Apply stock changes
    for (const [productId, change] of Object.entries(stockChanges)) {
      if (change !== 0) {
        const productRef = doc(db, "users", ownerId, "products", productId);
        batch.update(productRef, {
          stock: increment(change)
        });
      }
    }
    
    await batch.commit();
  };

  // Edit invoice (before delivery)
  const editInvoice = async () => {
    if (!selectedInvoice || !ownerId || !activeBranch?.id) return;
    
    // Validate stock for new items
    for (const item of editingItems) {
      const product = availableProducts.find(p => p.id === item.id);
      if (product && product.stock !== undefined) {
        const oldItem = selectedInvoice.items.find(i => i.id === item.id);
        const additionalQty = oldItem ? item.qty - oldItem.qty : item.qty;
        
        if (additionalQty > 0 && (product.stock < additionalQty)) {
          showToast('error', 'Insufficient Stock', `${item.name}: Only ${product.stock} available`);
          return;
        }
      }
    }
    
    setIsProcessing(true);
    try {
      // Update stock
      await updateStockForEdit(selectedInvoice.items, editingItems);
      
      // Recalculate totals
      const newSubtotal = editingItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
      const newTotal = newSubtotal - editingDiscount;
      const newBalance = newTotal - selectedInvoice.paid;
      
      // Update invoice
      const invoiceRef = doc(db, "users", ownerId, "invoices", selectedInvoice.id);
      await updateDoc(invoiceRef, {
        items: editingItems,
        subtotal: newSubtotal,
        discount: editingDiscount,
        total: newTotal,
        balance: newBalance > 0 ? newBalance : 0,
        paymentStatus: newBalance <= 0 ? "paid" : (selectedInvoice.paid > 0 ? "partial" : "credit"),
        updatedAt: serverTimestamp(),
      });
      
      showToast('success', 'Invoice Updated', 'Invoice has been modified successfully');
      setShowEditModal(false);
      setSelectedInvoice(null);
      setShowDetailModal(false);
      
    } catch (error: any) {
      console.error("Edit error:", error);
      showToast('error', 'Update Failed', error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // MARK AS DELIVERED
  const markAsDelivered = async () => {
    if (!selectedInvoice || !ownerId || !activeBranch?.id) return;

    setIsProcessing(true);
    try {
      const batch = writeBatch(db);
      
      const totalProfit = calculateTotalProfit(selectedInvoice);

      // 1. Update invoice status to delivered
      const invoiceRef = doc(db, "users", ownerId, "invoices", selectedInvoice.id);
      batch.update(invoiceRef, {
        status: "delivered",
        isDelivered: true,
        deliveredAt: serverTimestamp(),
        totalProfit: totalProfit,
      });

      // 2. CREATE SALE RECORD for tracking
      const salesRef = getUserCollection(ownerId, "sales");
      
      const saleData = {
        ownerId: ownerId,
        branchId: activeBranch.id,
        createdBy: currentUser?.name || 'System',
        role: currentUser?.role || 'owner',
        items: selectedInvoice.items.map((item: any) => ({
          id: item.id,
          name: item.name,
          qty: item.qty,
          price: item.price,
          profit: calculateItemProfit(item),
          purchaseRate: item.purchaseRate || item.purchasePrice || (item.price * 0.7),
          effectivePrice: item.price,
          effectiveProfit: calculateItemProfit(item),
          discount: item.discount || 0,
          discountType: item.discountType || null,
        })),
        discount: selectedInvoice.discount || 0,
        discountType: "flat",
        totalAmount: selectedInvoice.total,
        totalProfit: totalProfit,
        currency: currency.code,
        currencySymbol: currency.symbol,
        date: serverTimestamp(),
        returns: [],
        invoiceId: selectedInvoice.id,
        invoiceNumber: selectedInvoice.invoiceNumber,
        isFromInvoice: true,
        customerName: selectedInvoice.customerName,
        customerId: selectedInvoice.customerId,
        customerPhone: selectedInvoice.customerPhone || "",
        paymentStatus: selectedInvoice.paymentStatus,
        paidAmount: selectedInvoice.paid,
        remainingAmount: selectedInvoice.balance,
      };

      const saleRef = doc(salesRef);
      batch.set(saleRef, saleData);

      // 3. If there's remaining balance, add to customer's credit balance
      if (selectedInvoice.balance > 0) {
        const customerRef = doc(db, "users", ownerId, "customers", selectedInvoice.customerId);
        const customerDoc = await getDoc(customerRef);
        
        if (customerDoc.exists()) {
          const currentCredit = customerDoc.data().creditBalance || 0;
          batch.update(customerRef, {
            creditBalance: currentCredit + selectedInvoice.balance,
            totalPurchases: (customerDoc.data().totalPurchases || 0) + selectedInvoice.total,
            updatedAt: serverTimestamp(),
          });
        }
        
        // Add to ledger
        const ledgerRef = getUserCollection(ownerId, "ledger");
        const ledgerDoc = doc(ledgerRef);
        batch.set(ledgerDoc, {
          partyId: selectedInvoice.customerId,
          partyName: selectedInvoice.customerName,
          type: 'credit_sale',
          amount: selectedInvoice.balance,
          refId: selectedInvoice.id,
          invoiceNumber: selectedInvoice.invoiceNumber,
          branchId: activeBranch.id,
          date: serverTimestamp(),
          note: `Credit balance from invoice ${selectedInvoice.invoiceNumber}`,
        });
      }

      await batch.commit();

      showToast('success', 'Delivered & Sale Recorded', `Invoice #${selectedInvoice.invoiceNumber} marked as delivered. Profit: ${currency.symbol}${totalProfit.toLocaleString()}`);
      setShowDeliveryConfirm(false);
      setSelectedInvoice(null);
      setShowDetailModal(false);

    } catch (error: any) {
      console.error("Delivery error:", error);
      showToast('error', 'Delivery Failed', error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Add payment - ONLY after delivery
  const addPayment = async () => {
    if (!selectedInvoice || !ownerId || !activeBranch?.id) return;

    // FIX 1: Check if invoice is delivered before allowing payment
    if (!selectedInvoice.isDelivered && selectedInvoice.status !== "delivered") {
      showToast('error', 'Not Delivered', 'Please mark invoice as delivered first before adding payments');
      return;
    }

    const additionalPayment = parseFloat(paymentAmount);
    if (isNaN(additionalPayment) || additionalPayment <= 0) {
      showToast('error', 'Invalid Amount', 'Please enter a valid payment amount');
      return;
    }

    if (additionalPayment > selectedInvoice.balance) {
      showToast('error', 'Exceeds Balance', `Cannot pay more than remaining balance: ${currency.symbol}${selectedInvoice.balance.toLocaleString()}`);
      return;
    }

    setIsProcessing(true);
    try {
      const newPaid = selectedInvoice.paid + additionalPayment;
      const newBalance = selectedInvoice.balance - additionalPayment;
      let newPaymentStatus: "paid" | "credit" | "partial" = "credit";
      
      if (newBalance === 0) {
        newPaymentStatus = "paid";
      } else if (newPaid > 0 && newBalance > 0) {
        newPaymentStatus = "partial";
      }

      const invoiceRef = doc(db, "users", ownerId, "invoices", selectedInvoice.id);
      await updateDoc(invoiceRef, {
        paid: newPaid,
        balance: newBalance,
        paymentStatus: newPaymentStatus,
        updatedAt: serverTimestamp(),
      });

      // Update customer's credit balance (reduce the credit they owe)
      const customerRef = doc(db, "users", ownerId, "customers", selectedInvoice.customerId);
      const customerDoc = await getDoc(customerRef);
      if (customerDoc.exists()) {
        const currentCredit = customerDoc.data().creditBalance || 0;
        const creditReduction = Math.min(additionalPayment, currentCredit);
        await updateDoc(customerRef, {
          creditBalance: Math.max(0, currentCredit - creditReduction),
          updatedAt: serverTimestamp(),
        });
      }

      // Add ledger entry for payment
      const ledgerRef = getUserCollection(ownerId, "ledger");
      await addDoc(ledgerRef, {
        partyId: selectedInvoice.customerId,
        partyName: selectedInvoice.customerName,
        type: 'payment',
        amount: -additionalPayment,
        refId: selectedInvoice.id,
        invoiceNumber: selectedInvoice.invoiceNumber,
        branchId: activeBranch.id,
        date: serverTimestamp(),
        note: `Payment received for invoice ${selectedInvoice.invoiceNumber}`,
      });

      showToast('success', 'Payment Added', `Added ${currency.symbol}${additionalPayment.toLocaleString()}. Remaining: ${currency.symbol}${newBalance.toLocaleString()}`);
      setShowPaymentModal(false);
      setPaymentAmount("");
      setShowDetailModal(false);
      setSelectedInvoice(null);
      
    } catch (error) {
      console.error("Payment error:", error);
      showToast('error', 'Error', 'Failed to add payment');
    } finally {
      setIsProcessing(false);
    }
  };

  // Add remaining to credit - ONLY after delivery
  const addToCredit = async () => {
    if (!selectedInvoice || !ownerId || !activeBranch?.id) return;
    
    // FIX 2: Check if invoice is delivered before allowing credit conversion
    if (!selectedInvoice.isDelivered && selectedInvoice.status !== "delivered") {
      showToast('error', 'Not Delivered', 'Please mark invoice as delivered first before converting to credit');
      return;
    }
    
    if (selectedInvoice.balance <= 0) {
      showToast('error', 'No Balance', 'This invoice has no remaining balance');
      return;
    }

    if (!confirm(`This will convert ${currency.symbol}${selectedInvoice.balance.toLocaleString()} to customer's credit balance. The invoice will be marked as paid. Continue?`)) {
      return;
    }

    setIsProcessing(true);
    try {
      const batch = writeBatch(db);
      
      // Add to customer's credit balance
      const customerRef = doc(db, "users", ownerId, "customers", selectedInvoice.customerId);
      const customerDoc = await getDoc(customerRef);
      
      const currentCredit = customerDoc.exists() ? (customerDoc.data().creditBalance || 0) : 0;
      batch.update(customerRef, {
        creditBalance: currentCredit + selectedInvoice.balance,
        updatedAt: serverTimestamp(),
      });
      
      // Update invoice - mark as paid
      const invoiceRef = doc(db, "users", ownerId, "invoices", selectedInvoice.id);
      batch.update(invoiceRef, {
        paid: selectedInvoice.total,
        balance: 0,
        paymentStatus: "paid",
        notes: (selectedInvoice.notes || "") + `\n[${new Date().toLocaleString()}] Remaining balance ${currency.symbol}${selectedInvoice.balance.toLocaleString()} converted to customer credit. No cash received.`,
      });
      
      // Add ledger entry for credit conversion
      const ledgerRef = getUserCollection(ownerId, "ledger");
      const ledgerDoc = doc(ledgerRef);
      batch.set(ledgerDoc, {
        partyId: selectedInvoice.customerId,
        partyName: selectedInvoice.customerName,
        type: 'credit_conversion',
        amount: selectedInvoice.balance,
        refId: selectedInvoice.id,
        invoiceNumber: selectedInvoice.invoiceNumber,
        branchId: activeBranch.id,
        date: serverTimestamp(),
        note: `Remaining balance ${currency.symbol}${selectedInvoice.balance.toLocaleString()} converted to customer credit. No cash received.`,
      });
      
      await batch.commit();
      
      showToast('success', 'Converted to Credit', `${currency.symbol}${selectedInvoice.balance.toLocaleString()} added to customer's credit balance. Invoice marked as paid.`);
      setShowDetailModal(false);
      setSelectedInvoice(null);
      
    } catch (error) {
      console.error("Add to credit error:", error);
      showToast('error', 'Error', 'Failed to add to credit');
    } finally {
      setIsProcessing(false);
    }
  };

  // Update notes
  const updateNotes = async () => {
    if (!selectedInvoice || !ownerId) return;

    setIsProcessing(true);
    try {
      const invoiceRef = doc(db, "users", ownerId, "invoices", selectedInvoice.id);
      await updateDoc(invoiceRef, {
        notes: editNotes,
      });

      showToast('success', 'Updated', 'Invoice notes updated');
      setShowDetailModal(false);
      setSelectedInvoice(null);
      
    } catch (error) {
      console.error("Update notes error:", error);
      showToast('error', 'Error', 'Failed to update notes');
    } finally {
      setIsProcessing(false);
    }
  };

  // Open edit modal
  const openEditModal = () => {
    if (!selectedInvoice) return;
    setEditingItems(JSON.parse(JSON.stringify(selectedInvoice.items)));
    setEditingDiscount(selectedInvoice.discount || 0);
    setShowEditModal(true);
  };

  // Add product to editing items
  const addProductToEdit = (product: Product) => {
    const existing = editingItems.find(i => i.id === product.id);
    if (existing) {
      setEditingItems(editingItems.map(i => 
        i.id === product.id ? { ...i, qty: i.qty + 1 } : i
      ));
    } else {
      setEditingItems([...editingItems, {
        id: product.id,
        name: product.name,
        price: product.price,
        qty: 1,
        purchasePrice: product.purchasePrice || product.price * 0.7,
      }]);
    }
    setShowProductSearch(false);
    setSearchTerm("");
  };

  // Update item quantity
  const updateItemQty = (itemId: string, newQty: number) => {
    if (newQty < 0) return;
    if (newQty === 0) {
      setEditingItems(editingItems.filter(i => i.id !== itemId));
    } else {
      setEditingItems(editingItems.map(i => 
        i.id === itemId ? { ...i, qty: newQty } : i
      ));
    }
  };

  // Update item price
  const updateItemPrice = (itemId: string, newPrice: number) => {
    setEditingItems(editingItems.map(i => 
      i.id === itemId ? { ...i, price: newPrice } : i
    ));
  };

  // Remove item
  const removeItem = (itemId: string) => {
    setEditingItems(editingItems.filter(i => i.id !== itemId));
  };

  const handlePrint = (invoice: Invoice) => {
    const enrichedInvoice = {
      ...invoice,
      customerPhone: invoice.customerPhone || "",
      customerAddress: invoice.customerAddress || "",
      totalProfit: invoice.totalProfit || calculateTotalProfit(invoice),
    };
    setInvoiceToPrint(enrichedInvoice);
    setShowPrintModal(true);
  };

  const getStatusBadge = (invoice: Invoice) => {
    if (invoice.status === "delivered" || invoice.isDelivered) {
      return <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-semibold">✅ Delivered</span>;
    }
    return <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs font-semibold">⏳ Pending</span>;
  };

  const getPaymentBadge = (invoice: Invoice) => {
    if (invoice.paymentStatus === "paid") {
      return <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs font-semibold">✅ Paid</span>;
    } else if (invoice.paymentStatus === "partial") {
      return <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs font-semibold">💰 Partial ({currency.symbol}{Math.round(invoice.paid).toLocaleString()} paid)</span>;
    } else if (invoice.paymentStatus === "credit") {
      return <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs font-semibold">⚠️ Credit ({currency.symbol}{Math.round(invoice.balance).toLocaleString()} due)</span>;
    }
    return <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded-full text-xs font-semibold">Unknown</span>;
  };

  // Show branch selection warning
  if (!activeBranch?.id) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md text-center">
          <div className="text-6xl mb-4">🏪</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">No Branch Selected</h2>
          <p className="text-gray-600 mb-6">Please select a branch from the dashboard to manage invoices.</p>
          <Link href="/owner-dashboard" className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold transition-all">
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 animate-slide-in">
          <div className={`rounded-xl shadow-lg p-4 max-w-md border ${
            toast.type === 'success' ? 'bg-green-50 border-green-200' :
            toast.type === 'error' ? 'bg-red-50 border-red-200' :
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

      {/* Processing Overlay */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200]">
          <div className="bg-white rounded-2xl p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
            <p className="text-gray-700 font-semibold">Processing...</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-gradient-to-r from-gray-900 to-gray-800 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center text-xl font-bold">📋</div>
              <div>
                <h1 className="text-2xl font-bold">Invoice Management</h1>
                <p className="text-sm text-gray-300">Branch: {activeBranch?.shopName}</p>
              </div>
            </div>
            
            <div className="flex gap-3">
              <Link href="/wholesale-sales" className="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all">
                + New Invoice
              </Link>
              <Link href="/credit-list" className="bg-orange-500 hover:bg-orange-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all">
                💳 Credit List
              </Link>
              <Link href="/owner-dashboard" className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm font-semibold transition-all">
                Dashboard
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Info Banner - Updated */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-blue-800">
            <strong>📋 How it works:</strong><br/>
            • <strong>Pending Invoices</strong> - Can be edited (add/remove items, change quantities/prices, add discount)<br/>
            • <strong>Delivered</strong> - Once delivered, invoice cannot be edited<br/>
            • <strong>Payments & Credit</strong> - Only available AFTER delivery<br/>
            • <strong>Credit Invoices</strong> - Unpaid invoices appear in Credit List after delivery<br/>
            • <strong>Process:</strong> Create Invoice → Edit if needed → Mark as Delivered → Add Payments or Convert to Credit
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <button
            onClick={() => setFilter("all")}
            className={`px-6 py-2 rounded-lg font-semibold transition-all ${
              filter === "all" ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-100"
            }`}
          >
            All Invoices ({invoices.length})
          </button>
          <button
            onClick={() => setFilter("pending")}
            className={`px-6 py-2 rounded-lg font-semibold transition-all ${
              filter === "pending" ? "bg-yellow-600 text-white" : "bg-white text-gray-700 hover:bg-gray-100"
            }`}
          >
            ⏳ Pending ({invoices.filter(i => i.status !== "delivered" && !i.isDelivered).length})
          </button>
          <button
            onClick={() => setFilter("delivered")}
            className={`px-6 py-2 rounded-lg font-semibold transition-all ${
              filter === "delivered" ? "bg-green-600 text-white" : "bg-white text-gray-700 hover:bg-gray-100"
            }`}
          >
            ✅ Delivered ({invoices.filter(i => i.status === "delivered" || i.isDelivered).length})
          </button>
        </div>

        {/* Invoice List */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Invoice #</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Customer</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold">Total</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold">Paid</th>
                  <th className="px-6 py-3 text-right text-sm font-semibold">Balance</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold">Status</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold">Payment</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold">Created</th>
                  <th className="px-6 py-3 text-center text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-gray-400">
                      No invoices found
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map(invoice => (
                    <tr key={invoice.id} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-mono font-semibold text-sm">{invoice.invoiceNumber}</td>
                      <td className="px-6 py-4">
                        <div className="font-medium">{invoice.customerName}</div>
                        {invoice.customerPhone && <div className="text-xs text-gray-500">{invoice.customerPhone}</div>}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold">{currency.symbol}{Math.round(invoice.total || 0).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right text-green-600">{currency.symbol}{Math.round(invoice.paid || 0).toLocaleString()}</td>
                      <td className={`px-6 py-4 text-right font-bold ${(invoice.balance || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {currency.symbol}{Math.round(invoice.balance || 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-center">{getStatusBadge(invoice)}</td>
                      <td className="px-6 py-4 text-center">{getPaymentBadge(invoice)}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {invoice.createdAt?.toDate ? new Date(invoice.createdAt.toDate()).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => {
                            setSelectedInvoice(invoice);
                            setEditNotes(invoice.notes || "");
                            setShowDetailModal(true);
                          }}
                          className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-lg text-sm"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Invoice Detail Modal */}
      {showDetailModal && selectedInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className={`sticky top-0 p-6 text-white rounded-t-2xl ${
              selectedInvoice.status === "delivered" || selectedInvoice.isDelivered ? "bg-gradient-to-r from-green-600 to-green-700" : "bg-gradient-to-r from-yellow-600 to-orange-600"
            }`}>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-2xl font-bold">Invoice #{selectedInvoice.invoiceNumber}</h3>
                  <p className="text-sm opacity-90 mt-1">Created: {selectedInvoice.createdAt?.toDate ? new Date(selectedInvoice.createdAt.toDate()).toLocaleString() : '-'}</p>
                  {selectedInvoice.deliveredAt && (
                    <p className="text-sm opacity-90">Delivered: {selectedInvoice.deliveredAt?.toDate ? new Date(selectedInvoice.deliveredAt.toDate()).toLocaleString() : '-'}</p>
                  )}
                </div>
                <button onClick={() => { setShowDetailModal(false); setSelectedInvoice(null); }} className="text-3xl hover:scale-110 transition-transform">✕</button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Customer Info */}
              <div className="bg-gray-50 p-4 rounded-xl">
                <h4 className="font-semibold mb-2">Customer Details</h4>
                <p className="font-medium">{selectedInvoice.customerName}</p>
                {selectedInvoice.customerPhone && <p className="text-sm text-gray-600">📞 {selectedInvoice.customerPhone}</p>}
                {selectedInvoice.customerAddress && <p className="text-sm text-gray-600">📍 {selectedInvoice.customerAddress}</p>}
              </div>

              {/* Items Table */}
              <div>
                <h4 className="font-semibold mb-3">Items</h4>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm">Product</th>
                        <th className="px-4 py-2 text-center text-sm">Qty</th>
                        <th className="px-4 py-2 text-right text-sm">Price</th>
                        <th className="px-4 py-2 text-right text-sm">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedInvoice.items.map((item, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="px-4 py-2 text-sm">{item.name}</td>
                          <td className="px-4 py-2 text-center text-sm">{item.qty}</td>
                          <td className="px-4 py-2 text-right text-sm">{currency.symbol}{item.price.toLocaleString()}</td>
                          <td className="px-4 py-2 text-right text-sm font-semibold">{currency.symbol}{Math.round(item.price * item.qty).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary */}
              <div className="bg-gray-50 p-4 rounded-xl">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Subtotal:</span>
                    <span>{currency.symbol}{Math.round(selectedInvoice.subtotal || 0).toLocaleString()}</span>
                  </div>
                  {selectedInvoice.discount > 0 && (
                    <div className="flex justify-between text-sm text-green-600">
                      <span>Discount:</span>
                      <span>-{currency.symbol}{Math.round(selectedInvoice.discount).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-bold pt-2 border-t">
                    <span>Total Amount:</span>
                    <span>{currency.symbol}{Math.round(selectedInvoice.total || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Paid:</span>
                    <span>{currency.symbol}{Math.round(selectedInvoice.paid || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold text-orange-600">
                    <span>Remaining:</span>
                    <span>{currency.symbol}{Math.round(selectedInvoice.balance || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-semibold mb-2">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-vertical"
                  rows={2}
                  placeholder="Add notes..."
                />
                <button
                  onClick={updateNotes}
                  className="mt-2 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm"
                >
                  Save Notes
                </button>
              </div>

              {/* Action Buttons - FIXED: Only show payment/credit options after delivery */}
              <div className="flex flex-wrap gap-3 pt-4 border-t">
                {(!selectedInvoice.isDelivered && selectedInvoice.status !== "delivered") && (
                  <>
                    <button
                      onClick={openEditModal}
                      className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-semibold transition-all"
                    >
                      ✏️ Edit Invoice
                    </button>
                    <button
                      onClick={() => setShowDeliveryConfirm(true)}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-semibold transition-all"
                    >
                      🚚 Mark as Delivered
                    </button>
                  </>
                )}
                
                {/* Only show payment and credit options if invoice is delivered AND has balance */}
                {(selectedInvoice.isDelivered || selectedInvoice.status === "delivered") && selectedInvoice.balance > 0 && (
                  <>
                    <button
                      onClick={() => {
                        setPaymentAmount("");
                        setShowPaymentModal(true);
                      }}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-semibold transition-all"
                    >
                      💰 Add Payment (Cash)
                    </button>
                    <button
                      onClick={addToCredit}
                      className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-semibold transition-all"
                    >
                      📝 Convert to Credit (No Cash)
                    </button>
                  </>
                )}
                
                {/* Show message if delivered but fully paid */}
                {(selectedInvoice.isDelivered || selectedInvoice.status === "delivered") && selectedInvoice.balance === 0 && (
                  <div className="w-full text-center text-green-600 font-semibold py-2">
                    ✅ Invoice fully paid
                  </div>
                )}
                
                <button
                  onClick={() => handlePrint(selectedInvoice)}
                  className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-3 rounded-xl font-semibold transition-all"
                >
                  🖨️ Print
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Invoice Modal */}
      {showEditModal && selectedInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-6 sticky top-0">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-2xl font-bold">Edit Invoice #{selectedInvoice.invoiceNumber}</h3>
                  <p className="text-sm opacity-90">Customer: {selectedInvoice.customerName}</p>
                </div>
                <button onClick={() => setShowEditModal(false)} className="text-3xl hover:scale-110 transition-transform">✕</button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Add Product Button */}
              <div>
                <button
                  onClick={() => setShowProductSearch(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-semibold"
                >
                  + Add Product
                </button>
              </div>

              {/* Product Search Modal */}
              {showProductSearch && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
                  <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
                    <div className="bg-gray-800 text-white p-4">
                      <div className="flex justify-between items-center">
                        <h4 className="font-bold">Add Product</h4>
                        <button onClick={() => setShowProductSearch(false)} className="text-2xl">✕</button>
                      </div>
                      <input
                        type="text"
                        placeholder="Search products..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full mt-2 px-3 py-2 rounded text-black"
                        autoFocus
                      />
                    </div>
                    <div className="p-4 overflow-y-auto max-h-[60vh]">
                      {availableProducts
                        .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
                        .map(product => (
                          <div
                            key={product.id}
                            onClick={() => addProductToEdit(product)}
                            className="p-3 border-b hover:bg-gray-50 cursor-pointer flex justify-between"
                          >
                            <div>
                              <p className="font-semibold">{product.name}</p>
                              <p className="text-xs text-gray-500">Stock: {product.stock || 0}</p>
                            </div>
                            <p className="font-bold">{currency.symbol}{product.price.toLocaleString()}</p>
                          </div>
                        ))}
                      {availableProducts.length === 0 && (
                        <p className="text-center text-gray-400 py-8">Loading products...</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Items Table */}
              <div>
                <h4 className="font-semibold mb-3">Invoice Items</h4>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-2 text-left">Product</th>
                        <th className="px-4 py-2 text-center">Quantity</th>
                        <th className="px-4 py-2 text-right">Price</th>
                        <th className="px-4 py-2 text-right">Total</th>
                        <th className="px-4 py-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editingItems.map((item) => (
                        <tr key={item.id} className="border-b">
                          <td className="px-4 py-2">{item.name}</td>
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={item.qty}
                              onChange={(e) => updateItemQty(item.id, parseInt(e.target.value) || 0)}
                              className="w-20 px-2 py-1 border rounded text-center"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={item.price}
                              onChange={(e) => updateItemPrice(item.id, parseFloat(e.target.value) || 0)}
                              className="w-24 px-2 py-1 border rounded text-right"
                            />
                          </td>
                          <td className="px-4 py-2 text-right font-semibold">
                            {currency.symbol}{Math.round(item.price * item.qty).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <button
                              onClick={() => removeItem(item.id)}
                              className="text-red-600 hover:text-red-800"
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      ))}
                      {editingItems.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                            No items added. Click "Add Product" to add items.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Discount */}
              <div className="flex justify-end">
                <div className="w-64">
                  <label className="block text-sm font-semibold mb-1">Discount (₨)</label>
                  <input
                    type="number"
                    min="0"
                    value={editingDiscount}
                    onChange={(e) => setEditingDiscount(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border rounded"
                  />
                </div>
              </div>

              {/* Summary */}
              <div className="bg-gray-50 p-4 rounded-xl">
                <div className="space-y-2 text-right">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{currency.symbol}{Math.round(editingItems.reduce((sum, i) => sum + (i.price * i.qty), 0)).toLocaleString()}</span>
                  </div>
                  {editingDiscount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Discount:</span>
                      <span>-{currency.symbol}{Math.round(editingDiscount).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-lg font-bold pt-2 border-t">
                    <span>New Total:</span>
                    <span>{currency.symbol}{Math.round(editingItems.reduce((sum, i) => sum + (i.price * i.qty), 0) - editingDiscount).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Already Paid:</span>
                    <span>{currency.symbol}{Math.round(selectedInvoice.paid).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold text-orange-600">
                    <span>New Balance:</span>
                    <span>{currency.symbol}{Math.round(Math.max(0, editingItems.reduce((sum, i) => sum + (i.price * i.qty), 0) - editingDiscount - selectedInvoice.paid)).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 px-4 py-3 border rounded-xl font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={editInvoice}
                  disabled={isProcessing || editingItems.length === 0}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-xl font-semibold transition-all disabled:opacity-50"
                >
                  {isProcessing ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Confirmation Modal */}
      {showDeliveryConfirm && selectedInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-4">Confirm Delivery</h3>
            <div className="bg-yellow-50 p-4 rounded-lg mb-4">
              <p className="text-sm text-yellow-800">
                <strong>⚠️ Warning:</strong><br/>
                This will:<br/>
                • Mark invoice as delivered<br/>
                • Create a sale record with profit tracking<br/>
                • Add remaining balance to customer credit<br/>
                • This action cannot be undone<br/>
                • <strong>Note: Stock was already deducted when invoice was created</strong>
              </p>
            </div>
            <p className="mb-4">Are you sure you want to mark <strong>#{selectedInvoice.invoiceNumber}</strong> as delivered?</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeliveryConfirm(false)} className="flex-1 py-2 border rounded-lg">Cancel</button>
              <button onClick={markAsDelivered} className="flex-1 bg-green-600 text-white py-2 rounded-lg">Confirm Delivery</button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-4">Add Payment (Cash)</h3>
            <div className="bg-blue-50 p-3 rounded-lg mb-4">
              <div className="flex justify-between text-sm">
                <span>Invoice Total:</span>
                <span>{currency.symbol}{Math.round(selectedInvoice.total || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Already Paid:</span>
                <span>{currency.symbol}{Math.round(selectedInvoice.paid || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between font-bold mt-2 pt-2 border-t">
                <span>Remaining:</span>
                <span className="text-orange-600">{currency.symbol}{Math.round(selectedInvoice.balance || 0).toLocaleString()}</span>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-2">Payment Amount (Cash Received)</label>
              <input
                type="number"
                min="0"
                max={selectedInvoice.balance}
                step="1"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder={`Enter amount (max: ${currency.symbol}${selectedInvoice.balance.toLocaleString()})`}
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">This records actual cash payment received.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowPaymentModal(false)} className="flex-1 py-2 border rounded-lg">Cancel</button>
              <button onClick={addPayment} className="flex-1 bg-blue-600 text-white py-2 rounded-lg">Add Payment</button>
            </div>
          </div>
        </div>
      )}

      {/* Print Modal */}
      {showPrintModal && invoiceToPrint && (
        <InvoicePrint
          invoice={invoiceToPrint}
          shopName={activeBranch?.shopName || "My Store"}
          currency={currency}
          onClose={() => {
            setShowPrintModal(false);
            setInvoiceToPrint(null);
          }}
        />
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