"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
  getDoc,
} from "firebase/firestore";
import { useBranch } from "@/context/BranchContext";
import Link from "next/link";
import Image from "next/image";

interface CreditInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  items: any[];
  total: number;
  balance: number;
  notes?: string;
  createdAt: any;
  createdBy: string;
}

interface PaymentRecord {
  id: string;
  invoiceId: string;
  amount: number;
  createdAt: any;
  createdBy: string;
}

export default function CreditList() {
  const { activeBranch } = useBranch();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [creditInvoices, setCreditInvoices] = useState<CreditInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<CreditInvoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // Load user
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setIsLoading(false);
        return;
      }

      const uid = user.uid;
      try {
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
          setOwnerId(uid);
        } else {
          const empDoc = await getDoc(doc(db, "allEmployees", uid));
          if (empDoc.exists()) {
            setOwnerId(empDoc.data().ownerId);
          }
        }
      } catch (error) {
        console.error("Error loading user:", error);
      }
      setIsLoading(false);
    });

    return () => unsub();
  }, []);

  // Load credit invoices
  useEffect(() => {
    if (!activeBranch?.id || !ownerId) return;

    const q = query(
      collection(db, "invoices"),
      where("ownerId", "==", ownerId),
      where("branchId", "==", activeBranch.id),
      where("paymentStatus", "==", "credit"),
      where("balance", ">", 0),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const list: CreditInvoice[] = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      } as CreditInvoice));
      setCreditInvoices(list);
    });

    return () => unsub();
  }, [ownerId, activeBranch?.id]);

  // Record payment
  const recordPayment = async () => {
    if (!selectedInvoice) return;
    const amount = Number(paymentAmount);
    if (amount <= 0 || amount > selectedInvoice.balance) {
      alert("Invalid payment amount");
      return;
    }

    try {
      const newBalance = selectedInvoice.balance - amount;
      const paymentStatus = newBalance === 0 ? "paid" : "credit";

      // Update invoice
      const invoiceRef = doc(db, "invoices", selectedInvoice.id);
      await updateDoc(invoiceRef, {
        balance: newBalance,
        paymentStatus,
        paid: (selectedInvoice.total - selectedInvoice.balance) + amount,
      });

      // Record payment
      await addDoc(collection(db, "payments"), {
        invoiceId: selectedInvoice.id,
        customerId: selectedInvoice.customerId,
        amount,
        createdAt: serverTimestamp(),
        createdBy: "Owner",
      });

      setShowPaymentModal(false);
      setSelectedInvoice(null);
      setPaymentAmount("");
      alert("Payment recorded successfully!");
    } catch (error) {
      console.error("Error recording payment:", error);
      alert("Failed to record payment");
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "N/A";
    if (timestamp.toDate) {
      return timestamp.toDate().toLocaleDateString();
    }
    return new Date(timestamp).toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  const totalCredit = creditInvoices.reduce((sum, inv) => sum + inv.balance, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-gray-900 to-gray-800 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/owner-dashboard">
                <Image src="/stockaro-logo.png" alt="Logo" width={40} height={40} className="rounded-lg" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Credit List</h1>
                <p className="text-sm text-gray-300">{activeBranch?.shopName || 'Select Branch'}</p>
              </div>
            </div>
            <Link 
              href="/wholesale-sales"
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-semibold transition"
            >
              ← Back to Sales
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Summary Card */}
        <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-2xl p-6 mb-8">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm opacity-90">Total Credit Outstanding</p>
              <p className="text-3xl font-bold">₨{totalCredit.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm opacity-90">Total Invoices</p>
              <p className="text-2xl font-bold">{creditInvoices.length}</p>
            </div>
          </div>
        </div>

        {/* Credit Invoices Table */}
        {creditInvoices.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
            <div className="text-6xl mb-4">📋</div>
            <p className="text-gray-500 text-lg">No credit invoices</p>
            <p className="text-gray-400 mt-2">All invoices are paid</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="p-4 text-left">Invoice #</th>
                    <th className="p-4 text-left">Customer</th>
                    <th className="p-4 text-right">Total</th>
                    <th className="p-4 text-right">Balance</th>
                    <th className="p-4 text-left">Date</th>
                    <th className="p-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {creditInvoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b hover:bg-gray-50">
                      <td className="p-4 font-mono text-sm">{invoice.invoiceNumber}</td>
                      <td className="p-4 font-semibold">{invoice.customerName}</td>
                      <td className="p-4 text-right">₨{invoice.total.toLocaleString()}</td>
                      <td className="p-4 text-right text-orange-600 font-bold">₨{invoice.balance.toLocaleString()}</td>
                      <td className="p-4 text-sm text-gray-500">{formatDate(invoice.createdAt)}</td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => {
                            setSelectedInvoice(invoice);
                            setShowPaymentModal(true);
                          }}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition"
                        >
                          Record Payment
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Payment Modal */}
      {showPaymentModal && selectedInvoice && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
            <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white p-5 rounded-t-2xl">
              <h3 className="text-xl font-bold">Record Payment</h3>
              <p className="text-sm">Invoice: {selectedInvoice.invoiceNumber}</p>
            </div>
            
            <div className="p-5 space-y-4">
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">Customer</p>
                <p className="font-semibold">{selectedInvoice.customerName}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">Outstanding Balance</p>
                <p className="text-2xl font-bold text-orange-600">₨{selectedInvoice.balance.toLocaleString()}</p>
              </div>
              
              <input
                type="number"
                placeholder="Payment Amount"
                className="w-full px-4 py-3 border rounded-xl focus:border-blue-500 outline-none"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                autoFocus
              />
              
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowPaymentModal(false);
                    setSelectedInvoice(null);
                    setPaymentAmount("");
                  }}
                  className="flex-1 py-3 border border-gray-300 rounded-xl hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={recordPayment}
                  className="flex-1 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700"
                >
                  Record Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}