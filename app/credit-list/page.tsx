"use client";

import { useState, useEffect, useMemo } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  getDoc,
  doc,
  writeBatch,
  updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useBranch } from "@/context/BranchContext";
import Link from "next/link";

interface Customer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  openingBalance?: number;
  creditBalance?: number;
  totalPurchases?: number;
  isActive: boolean;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  total: number;
  paid: number;
  balance: number;
  paymentStatus: 'paid' | 'credit' | 'partial';
  status?: string;
  isDelivered?: boolean;
  createdAt: any;
  dueDate?: any;
  branchId?: string;
  items?: any[];
}

interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  amount: number;
  date: any;
  note?: string;
  branchId?: string;
}

interface InvoiceBalance {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  phone?: string;
  address?: string;
  totalAmount: number;
  paidAmount: number;
  remainingBalance: number;
  status: 'paid' | 'partial' | 'unpaid';
  invoiceDate: any;
  dueDate?: any;
  payments: Payment[];
  isDelivered: boolean;
}

export default function CreditListPage() {
  const { activeBranch } = useBranch();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceBalance | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [currency] = useState({ symbol: "₨", code: "PKR" });
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'unpaid' | 'partial' | 'paid'>('unpaid');

  // Helper functions for user subcollection
  const getUserCollection = (userId: string, collectionName: string) => {
    return collection(db, "users", userId, collectionName);
  };

  const getUserDoc = (userId: string, collectionName: string, docId: string) => {
    return doc(db, "users", userId, collectionName, docId);
  };

  // Load user
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setIsLoading(false);
        return;
      }
      setOwnerId(user.uid);
      
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setCurrentUser({ name: userData.name || "User", role: "owner" });
        }
      } catch (error) {
        console.error("Error loading user:", error);
      }
      
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Load customers from USER's subcollection
  useEffect(() => {
    if (!activeBranch?.id || !ownerId) return;

    const customersRef = getUserCollection(ownerId, "customers");
    const q = query(
      customersRef,
      where("isActive", "==", true),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: Customer[] = snap.docs.map((d) => ({
        id: d.id,
        name: d.data().name,
        phone: d.data().phone || "",
        address: d.data().address || "",
        openingBalance: d.data().openingBalance || 0,
        creditBalance: d.data().creditBalance || 0,
        totalPurchases: d.data().totalPurchases || 0,
        isActive: d.data().isActive,
      }));
      setCustomers(list);
    });
    return () => unsub();
  }, [ownerId, activeBranch?.id]);

  // Load invoices from USER's subcollection - FIXED: Use createdAt not date
  useEffect(() => {
    if (!activeBranch?.id || !ownerId) return;

    const invoicesRef = getUserCollection(ownerId, "invoices");
    const q = query(
      invoicesRef,
      where("branchId", "==", activeBranch.id),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: Invoice[] = snap.docs.map((d) => {
        const data = d.data();
        // Calculate balance correctly
        const total = data.total || 0;
        const paid = data.paid || 0;
        const balance = data.balance !== undefined ? data.balance : total - paid;
        
        // Determine payment status
        let paymentStatus = data.paymentStatus;
        if (balance === 0 && paid === total && total > 0) {
          paymentStatus = "paid";
        } else if (paid > 0 && balance > 0) {
          paymentStatus = "partial";
        } else if (balance > 0 && paid === 0) {
          paymentStatus = "credit";
        }
        
        return {
          id: d.id,
          invoiceNumber: data.invoiceNumber,
          customerId: data.customerId,
          customerName: data.customerName,
          total: total,
          paid: paid,
          balance: balance,
          paymentStatus: paymentStatus,
          status: data.status || (data.isDelivered ? "delivered" : "pending"),
          isDelivered: data.isDelivered || false,
          createdAt: data.createdAt,
          dueDate: data.dueDate,
          branchId: data.branchId,
          items: data.items || []
        };
      });
      setInvoices(list);
    });
    return () => unsub();
  }, [ownerId, activeBranch?.id]);

  // Load payments from USER's subcollection
  useEffect(() => {
    if (!activeBranch?.id || !ownerId) return;

    const paymentsRef = getUserCollection(ownerId, "payments");
    const q = query(
      paymentsRef,
      where("branchId", "==", activeBranch.id),
      orderBy("date", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: Payment[] = snap.docs.map((d) => ({
        id: d.id,
        ...d.data()
      } as Payment));
      setPayments(list);
    });
    return () => unsub();
  }, [ownerId, activeBranch?.id]);

  // Calculate balances for each invoice - FIXED: Only show delivered invoices with balances
  const invoiceBalances = useMemo(() => {
    const balances: { [key: string]: InvoiceBalance } = {};

    // Initialize with invoices that are delivered AND have balance > 0 OR are partial/paid
    invoices.forEach(invoice => {
      // Only include delivered invoices (credit only applies after delivery)
      if (invoice.isDelivered && (invoice.balance > 0 || invoice.paymentStatus === 'partial' || invoice.paymentStatus === 'paid')) {
        const customer = customers.find(c => c.id === invoice.customerId);
        // Map payment status to credit list status
        let listStatus: 'paid' | 'partial' | 'unpaid' = 'unpaid';
        if (invoice.paymentStatus === 'paid') {
          listStatus = 'paid';
        } else if (invoice.paymentStatus === 'partial') {
          listStatus = 'partial';
        } else if (invoice.balance > 0 && invoice.paid === 0) {
          listStatus = 'unpaid';
        }
        
        balances[invoice.id] = {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          customerName: invoice.customerName,
          phone: customer?.phone,
          address: customer?.address,
          totalAmount: invoice.total,
          paidAmount: invoice.paid,
          remainingBalance: invoice.balance,
          status: listStatus,
          invoiceDate: invoice.createdAt,
          dueDate: invoice.dueDate,
          payments: [],
          isDelivered: invoice.isDelivered
        };
      }
    });

    // Add payments to respective invoices
    payments.forEach(payment => {
      if (balances[payment.invoiceId]) {
        balances[payment.invoiceId].payments.push(payment);
      }
    });

    // Sort by remaining balance (highest due first)
    return Object.values(balances).sort((a, b) => b.remainingBalance - a.remainingBalance);
  }, [invoices, payments, customers]);

  // Filter invoices based on status
  const filteredInvoices = useMemo(() => {
    if (filterStatus === 'all') return invoiceBalances;
    return invoiceBalances.filter(inv => inv.status === filterStatus);
  }, [invoiceBalances, filterStatus]);

  // Add payment to invoice
  const addPayment = async () => {
    if (!selectedInvoice || !ownerId || !activeBranch?.id) return;
    
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    if (amount > selectedInvoice.remainingBalance) {
      alert(`Cannot pay more than invoice balance: ${currency.symbol}${selectedInvoice.remainingBalance.toLocaleString()}`);
      return;
    }

    setIsProcessing(true);
    try {
      const batch = writeBatch(db);
      
      // Add payment record
      const paymentsRef = getUserCollection(ownerId, "payments");
      const paymentDoc = doc(paymentsRef);
      batch.set(paymentDoc, {
        invoiceId: selectedInvoice.invoiceId,
        invoiceNumber: selectedInvoice.invoiceNumber,
        customerId: selectedInvoice.customerId,
        customerName: selectedInvoice.customerName,
        amount: amount,
        date: serverTimestamp(),
        note: paymentNote || "Payment received",
        branchId: activeBranch.id,
      });
      
      // Update invoice
      const invoiceRef = getUserDoc(ownerId, "invoices", selectedInvoice.invoiceId);
      const newPaidAmount = selectedInvoice.paidAmount + amount;
      const newRemainingBalance = selectedInvoice.totalAmount - newPaidAmount;
      const newPaymentStatus = newRemainingBalance === 0 ? 'paid' : 'partial';
      
      batch.update(invoiceRef, {
        paid: newPaidAmount,
        balance: newRemainingBalance,
        paymentStatus: newPaymentStatus,
        updatedAt: serverTimestamp(),
      });
      
      // Update customer's credit balance if applicable
      if (selectedInvoice.remainingBalance > 0) {
        const customerRef = getUserDoc(ownerId, "customers", selectedInvoice.customerId);
        const customerDoc = await getDoc(customerRef);
        if (customerDoc.exists()) {
          const currentCredit = customerDoc.data().creditBalance || 0;
          const newCredit = Math.max(0, currentCredit - amount);
          batch.update(customerRef, {
            creditBalance: newCredit,
            updatedAt: serverTimestamp(),
          });
        }
      }
      
      // Add ledger entry
      const ledgerRef = getUserCollection(ownerId, "ledger");
      batch.set(doc(ledgerRef), {
        partyId: selectedInvoice.customerId,
        partyName: selectedInvoice.customerName,
        type: 'payment',
        amount: -amount,
        invoiceId: selectedInvoice.invoiceId,
        invoiceNumber: selectedInvoice.invoiceNumber,
        branchId: activeBranch.id,
        date: serverTimestamp(),
        note: `Payment received for invoice ${selectedInvoice.invoiceNumber}`,
      });
      
      await batch.commit();
      
      setShowPaymentModal(false);
      setPaymentAmount("");
      setPaymentNote("");
      alert(`Payment of ${currency.symbol}${amount.toLocaleString()} recorded successfully! Invoice ${newRemainingBalance === 0 ? 'fully paid' : 'partially paid'}.`);
      
      // Refresh selected invoice data
      setSelectedInvoice(null);
    } catch (error) {
      console.error("Payment error:", error);
      alert("Failed to add payment");
    } finally {
      setIsProcessing(false);
    }
  };

  // Get badge color based on status
  const getStatusBadge = (status: string, remainingBalance: number) => {
    if (remainingBalance === 0 || status === 'paid') {
      return "bg-green-100 text-green-800";
    } else if (status === 'partial') {
      return "bg-yellow-100 text-yellow-800";
    }
    return "bg-red-100 text-red-800";
  };

  const getStatusText = (status: string, remainingBalance: number) => {
    if (remainingBalance === 0 || status === 'paid') return "Paid";
    if (status === 'partial') return "Partial";
    return "Unpaid";
  };

  // Get badge color based on balance amount
  const getBalanceBadge = (balance: number) => {
    if (balance > 50000) {
      return "bg-red-100 text-red-800";
    } else if (balance > 10000) {
      return "bg-orange-100 text-orange-800";
    } else if (balance > 0) {
      return "bg-yellow-100 text-yellow-800";
    }
    return "bg-green-100 text-green-800";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!ownerId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Please Login</h2>
          <Link href="/login" className="text-blue-600 underline">Go to Login</Link>
        </div>
      </div>
    );
  }

  // Calculate summary stats - only for delivered invoices
  const totalOutstanding = invoiceBalances.reduce((sum, inv) => sum + inv.remainingBalance, 0);
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalInvoiced = invoices.filter(i => i.isDelivered).reduce((sum, inv) => sum + inv.total, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
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
              <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center text-xl font-bold">💰</div>
              <div>
                <h1 className="text-2xl font-bold">Credit Invoices</h1>
                <p className="text-sm text-gray-300">Manage invoice payments</p>
              </div>
            </div>
            
            <div className="flex gap-3">
              <Link href="/wholesale-sales" className="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all">
                + New Invoice
              </Link>
              <Link href="/invoice-management" className="bg-green-500 hover:bg-green-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all">
                📋 Manage Invoices
              </Link>
              <Link href="/owner-dashboard" className="bg-gray-600 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm font-semibold transition-all">
                Dashboard
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">Total Invoiced (Delivered)</p>
                <p className="text-2xl font-bold text-blue-600">
                  {currency.symbol}{totalInvoiced.toLocaleString()}
                </p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-2xl">📄</div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">Total Received</p>
                <p className="text-2xl font-bold text-green-600">
                  {currency.symbol}{totalPaid.toLocaleString()}
                </p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-2xl">✅</div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-lg p-6 border-l-4 border-red-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-sm mb-1">Outstanding Balance</p>
                <p className="text-2xl font-bold text-red-600">
                  {currency.symbol}{totalOutstanding.toLocaleString()}
                </p>
              </div>
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-2xl">⚠️</div>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="mb-6 flex gap-2 border-b">
          <button
            onClick={() => setFilterStatus('unpaid')}
            className={`px-6 py-3 font-semibold transition-all ${
              filterStatus === 'unpaid' 
                ? 'border-b-2 border-red-500 text-red-600' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Unpaid ({invoiceBalances.filter(i => i.status === 'unpaid').length})
          </button>
          <button
            onClick={() => setFilterStatus('partial')}
            className={`px-6 py-3 font-semibold transition-all ${
              filterStatus === 'partial' 
                ? 'border-b-2 border-yellow-500 text-yellow-600' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Partial ({invoiceBalances.filter(i => i.status === 'partial').length})
          </button>
          <button
            onClick={() => setFilterStatus('paid')}
            className={`px-6 py-3 font-semibold transition-all ${
              filterStatus === 'paid' 
                ? 'border-b-2 border-green-500 text-green-600' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Paid ({invoiceBalances.filter(i => i.status === 'paid').length})
          </button>
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-6 py-3 font-semibold transition-all ${
              filterStatus === 'all' 
                ? 'border-b-2 border-gray-500 text-gray-700' 
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            All Invoices ({invoiceBalances.length})
          </button>
        </div>

        {/* Invoice List */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-gray-50 to-gray-100 border-b">
            <h2 className="font-semibold text-gray-700">
              {filterStatus === 'unpaid' ? 'Unpaid Invoices' : 
               filterStatus === 'partial' ? 'Partially Paid Invoices' :
               filterStatus === 'paid' ? 'Paid Invoices' : 'All Credit Invoices'}
            </h2>
          </div>
          
          {filteredInvoices.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-6xl mb-4">✅</div>
              <p className="text-lg">No {filterStatus} invoices found</p>
              <p className="text-sm mt-1">
                {filterStatus === 'unpaid' ? 'All credit invoices have been paid' : 
                 filterStatus === 'partial' ? 'No partially paid invoices' :
                 filterStatus === 'paid' ? 'No paid invoices in this period' : 
                 'No delivered invoices with credit yet'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Invoice #</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Customer</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Total</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Paid</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Balance</th>
                    <th className="px-6 py-4 text-center text-sm font-semibold text-gray-700">Status</th>
                    <th className="px-6 py-4 text-center text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((invoice) => (
                    <tr 
                      key={invoice.invoiceId} 
                      className="border-b hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => setSelectedInvoice(invoice)}
                    >
                      <td className="px-6 py-4">
                        <div className="font-mono font-semibold text-gray-900">{invoice.invoiceNumber}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {invoice.invoiceDate?.toDate ? new Date(invoice.invoiceDate.toDate()).toLocaleDateString() : '-'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-gray-900">{invoice.customerName}</div>
                        {invoice.phone && <div className="text-xs text-gray-500 mt-1">📞 {invoice.phone}</div>}
                      </td>
                      <td className="px-6 py-4 text-right font-medium text-gray-900">
                        {currency.symbol}{invoice.totalAmount.toLocaleString()}
                       </td>
                      <td className="px-6 py-4 text-right text-green-600 font-medium">
                        {currency.symbol}{invoice.paidAmount.toLocaleString()}
                       </td>
                      <td className="px-6 py-4 text-right">
                        <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${getBalanceBadge(invoice.remainingBalance)}`}>
                          {currency.symbol}{invoice.remainingBalance.toLocaleString()}
                        </span>
                       </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${getStatusBadge(invoice.status, invoice.remainingBalance)}`}>
                          {getStatusText(invoice.status, invoice.remainingBalance)}
                        </span>
                       </td>
                      <td className="px-6 py-4 text-center">
                        {invoice.remainingBalance > 0 && (
                          <button
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              setSelectedInvoice(invoice); 
                              setShowPaymentModal(true); 
                            }}
                            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm"
                          >
                            Receive Payment
                          </button>
                        )}
                        {invoice.remainingBalance === 0 && (
                          <span className="text-green-600 text-sm font-semibold">✓ Paid</span>
                        )}
                       </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        
        {/* Info Box */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-sm text-blue-800">
            <strong>📋 Credit Management:</strong><br/>
            • Only <strong>delivered invoices</strong> appear in the credit list<br/>
            • Each invoice is tracked individually with its own payment status<br/>
            • <strong>Unpaid</strong> - No payments received yet (Full amount due)<br/>
            • <strong>Partial</strong> - Some payments received, balance remaining<br/>
            • <strong>Paid</strong> - Invoice fully paid<br/>
            • Click on any invoice row to view detailed payment history<br/>
            • Payments recorded here automatically update customer credit balance
          </p>
        </div>
      </main>

      {/* Invoice Detail Modal */}
      {selectedInvoice && !showPaymentModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[85vh] overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-2xl font-bold">Invoice #{selectedInvoice.invoiceNumber}</h3>
                  <p className="text-lg mt-1">{selectedInvoice.customerName}</p>
                  <div className="flex gap-4 mt-2 text-sm opacity-90">
                    {selectedInvoice.phone && <span>📞 {selectedInvoice.phone}</span>}
                    {selectedInvoice.address && <span>📍 {selectedInvoice.address}</span>}
                  </div>
                  <div className="mt-3 flex gap-3">
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${getBalanceBadge(selectedInvoice.remainingBalance)}`}>
                      Balance: {currency.symbol}{selectedInvoice.remainingBalance.toLocaleString()}
                    </span>
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${getStatusBadge(selectedInvoice.status, selectedInvoice.remainingBalance)}`}>
                      {getStatusText(selectedInvoice.status, selectedInvoice.remainingBalance)}
                    </span>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedInvoice(null)} 
                  className="text-3xl hover:scale-110 transition-transform"
                >
                  ✕
                </button>
              </div>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[calc(85vh-140px)]">
              {/* Action Buttons */}
              {selectedInvoice.remainingBalance > 0 && (
                <div className="mb-6">
                  <button 
                    onClick={() => setShowPaymentModal(true)} 
                    className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-semibold transition-all shadow-md"
                  >
                    💰 Receive Payment ({currency.symbol}{selectedInvoice.remainingBalance.toLocaleString()} remaining)
                  </button>
                </div>
              )}

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-50 rounded-xl p-4 text-center border border-gray-200">
                  <p className="text-xs text-gray-600 uppercase">Invoice Total</p>
                  <p className="text-xl font-bold text-gray-800">{currency.symbol}{selectedInvoice.totalAmount.toLocaleString()}</p>
                </div>
                <div className="bg-green-50 rounded-xl p-4 text-center border border-green-200">
                  <p className="text-xs text-green-600 uppercase">Total Paid</p>
                  <p className="text-xl font-bold text-green-700">{currency.symbol}{selectedInvoice.paidAmount.toLocaleString()}</p>
                </div>
                <div className={`${selectedInvoice.remainingBalance > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'} rounded-xl p-4 text-center border`}>
                  <p className={`text-xs uppercase ${selectedInvoice.remainingBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>Remaining Balance</p>
                  <p className={`text-xl font-bold ${selectedInvoice.remainingBalance > 0 ? 'text-red-700' : 'text-green-700'}`}>{currency.symbol}{selectedInvoice.remainingBalance.toLocaleString()}</p>
                </div>
              </div>

              {/* Payment History */}
              <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <span className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-xs">💵</span>
                Payment History
              </h4>
              
              {selectedInvoice.payments.length === 0 ? (
                <div className="text-center py-8 text-gray-400 border rounded-xl">
                  <p>No payments recorded for this invoice</p>
                </div>
              ) : (
                <div className="border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-3 text-left">Date</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                        <th className="px-4 py-3 text-left">Note</th>
                        <th className="px-4 py-3 text-left">Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedInvoice.payments.map((payment, idx) => (
                        <tr key={payment.id} className={`border-t ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                          <td className="px-4 py-2 text-xs">
                            {payment.date?.toDate ? new Date(payment.date.toDate()).toLocaleDateString() : '-'}
                          </td>
                          <td className="px-4 py-2 text-right font-mono font-semibold text-green-600">
                            +{currency.symbol}{payment.amount.toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-600">
                            {payment.note || '-'}
                          </td>
                          <td className="px-4 py-2 text-xs text-gray-500">
                            {payment.id?.substring(0, 8) || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && selectedInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
            <div className="bg-gradient-to-r from-green-600 to-green-700 text-white p-6 rounded-t-2xl">
              <h3 className="text-2xl font-bold">💰 Receive Payment</h3>
              <p className="text-sm opacity-90 mt-1">Record payment for invoice #{selectedInvoice.invoiceNumber}</p>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 p-4 rounded-xl">
                <p className="text-sm text-gray-600">Customer</p>
                <p className="font-bold text-lg">{selectedInvoice.customerName}</p>
                <div className="flex justify-between mt-2 pt-2 border-t">
                  <span className="text-sm">Invoice Total:</span>
                  <span className="font-medium">{currency.symbol}{selectedInvoice.totalAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-sm">Already Paid:</span>
                  <span className="font-medium text-green-600">{currency.symbol}{selectedInvoice.paidAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between mt-1 pt-1 border-t">
                  <span className="text-sm font-semibold">Remaining Balance:</span>
                  <span className="font-bold text-red-600">{currency.symbol}{selectedInvoice.remainingBalance.toLocaleString()}</span>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Amount</label>
                <input 
                  type="number" 
                  step="1"
                  min="1"
                  max={selectedInvoice.remainingBalance}
                  placeholder="Enter amount" 
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200" 
                  value={paymentAmount} 
                  onChange={(e) => setPaymentAmount(e.target.value)} 
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-1">Max: {currency.symbol}{selectedInvoice.remainingBalance.toLocaleString()}</p>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Note (Optional)</label>
                <input 
                  type="text" 
                  placeholder="Payment reference or note" 
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200" 
                  value={paymentNote} 
                  onChange={(e) => setPaymentNote(e.target.value)} 
                />
              </div>
              
              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => { 
                    setShowPaymentModal(false); 
                    setPaymentAmount(""); 
                    setPaymentNote(""); 
                  }} 
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-xl hover:bg-gray-50 transition-all font-semibold"
                >
                  Cancel
                </button>
                <button 
                  onClick={addPayment} 
                  disabled={isProcessing} 
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-xl font-semibold transition-all disabled:opacity-50"
                >
                  {isProcessing ? 'Processing...' : 'Add Payment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}