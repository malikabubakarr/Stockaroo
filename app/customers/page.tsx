// ============================================
// PAGE 3: Customers (app/customers/page.tsx)
// ============================================
"use client";

import { useState, useEffect, useCallback } from "react";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  setDoc,
  enableNetwork,
  disableNetwork,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";

interface Customer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  openingBalance?: number;
  totalPurchases?: number;
  isActive: boolean;
  createdAt: any;
  updatedAt?: any;
}

interface ToastMessage {
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
}

export default function CustomersPage() {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [authUser, setAuthUser] = useState<any>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  
  // Form state
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [currency] = useState({ symbol: "₨", code: "PKR" });

  // Helper functions
  const getUserCollection = (userId: string, collectionName: string) => {
    return collection(db, "users", userId, collectionName);
  };

  const getUserDoc = (userId: string, collectionName: string, docId: string) => {
    return doc(db, "users", userId, collectionName, docId);
  };

  const showToast = (type: ToastMessage['type'], title: string, message: string) => {
    setToast({ type, title, message });
    setTimeout(() => setToast(null), 3000);
  };

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast('success', 'Back Online', 'Connected to Firestore. Syncing data...');
      // Re-enable network
      enableNetwork(db).catch(console.error);
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      showToast('warning', 'Offline Mode', 'You are offline. Changes will sync when online.');
      disableNetwork(db).catch(console.error);
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load authenticated user
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log("🔐 Auth state changed:", user?.uid);
      
      if (!user) {
        console.log("❌ No user authenticated");
        setOwnerId(null);
        setAuthUser(null);
        setIsLoading(false);
        return;
      }
      
      setAuthUser(user);
      setOwnerId(user.uid);
      console.log("✅ User authenticated:", user.uid);
      
      // Ensure user document exists
      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (!userSnap.exists()) {
          console.log("📝 Creating user document...");
          await setDoc(userRef, {
            email: user.email,
            name: user.displayName || user.email?.split('@')[0] || "User",
            role: "owner",
            createdAt: serverTimestamp(),
          });
          console.log("✅ User document created");
        }
      } catch (error) {
        console.error("Error ensuring user document:", error);
      }
      
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Load customers with REAL-TIME sync - This ensures all devices see same data
  useEffect(() => {
    if (!ownerId) {
      console.log("⏳ Waiting for ownerId...");
      return;
    }

    console.log("📡 Setting up real-time listener for customers");
    console.log("Firestore path: users ->", ownerId, "-> customers");
    
    const customersRef = getUserCollection(ownerId, "customers");
    const q = query(
      customersRef,
      where("isActive", "==", true),
      orderBy("createdAt", "desc")
    );

    // REAL-TIME listener - updates instantly across all devices
    const unsub = onSnapshot(q, 
      (snap) => {
        const now = new Date();
        setLastSyncTime(now);
        
        console.log(`📊 Real-time update: ${snap.size} customers at ${now.toLocaleTimeString()}`);
        
        const list: Customer[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name,
            phone: data.phone || "",
            address: data.address || "",
            openingBalance: data.openingBalance || 0,
            totalPurchases: data.totalPurchases || 0,
            isActive: data.isActive,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          } as Customer;
        });
        
        setCustomers(list);
        
        // Show sync notification (optional - can be removed if annoying)
        if (snap.docChanges().length > 0 && snap.docChanges().some(change => change.type !== 'added')) {
          showToast('info', 'Sync Update', `${snap.docChanges().length} customer(s) updated`);
        }
      },
      (error) => {
        console.error("❌ Firestore error:", error);
        console.error("Error code:", error.code);
        console.error("Error message:", error.message);
        
        if (error.code === 'permission-denied') {
          showToast('error', 'Permission Denied', 'Please check your Firestore security rules');
        } else {
          showToast('error', 'Connection Error', error.message);
        }
      }
    );

    return () => {
      console.log("🛑 Removing real-time listener");
      unsub();
    };
  }, [ownerId]);

  // Add or update customer
  const saveCustomer = async () => {
    if (!name.trim()) {
      showToast('error', 'Required', 'Customer name is required');
      return;
    }

    if (!ownerId) {
      showToast('error', 'Error', 'User not authenticated');
      return;
    }

    if (!isOnline) {
      showToast('error', 'Offline', 'Cannot save while offline. Please check your internet connection.');
      return;
    }

    setIsProcessing(true);
    try {
      if (editingCustomer) {
        // Update existing customer
        const customerRef = getUserDoc(ownerId, "customers", editingCustomer.id);
        await updateDoc(customerRef, {
          name: name.trim(),
          phone: phone.trim() || "",
          address: address.trim() || "",
          updatedAt: serverTimestamp(),
        });
        
        showToast('success', 'Updated', `Customer ${name} updated successfully!`);
      } else {
        // Create new customer
        const balance = parseFloat(openingBalance) || 0;
        const customersRef = getUserCollection(ownerId, "customers");
        
        const customerData = {
          name: name.trim(),
          phone: phone.trim() || "",
          address: address.trim() || "",
          openingBalance: balance,
          totalPurchases: 0,
          isActive: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        console.log("📝 Creating customer:", customerData);
        
        const docRef = await addDoc(customersRef, customerData);
        console.log("✅ Customer created with ID:", docRef.id);

        // Add ledger entry for opening balance
        if (balance !== 0) {
          const ledgerRef = getUserCollection(ownerId, "ledger");
          await addDoc(ledgerRef, {
            partyId: docRef.id,
            partyName: name.trim(),
            type: 'opening',
            amount: balance,
            refId: docRef.id,
            date: serverTimestamp(),
            note: `Opening balance for ${name}`,
          });
        }
        
        showToast('success', 'Created', `Customer ${name} added successfully!`);
      }
      
      // Reset form
      setName("");
      setPhone("");
      setAddress("");
      setOpeningBalance("");
      setEditingCustomer(null);
      setShowAddModal(false);
    } catch (error: any) {
      console.error("❌ Error saving customer:", error);
      showToast('error', 'Error', error.message || 'Failed to save customer');
    } finally {
      setIsProcessing(false);
    }
  };

  // Edit customer
  const editCustomer = (customer: Customer) => {
    setEditingCustomer(customer);
    setName(customer.name);
    setPhone(customer.phone || "");
    setAddress(customer.address || "");
    setOpeningBalance(customer.openingBalance?.toString() || "");
    setShowAddModal(true);
  };

  // Delete customer
  const deleteCustomer = async (customer: Customer) => {
    if (!confirm(`Are you sure you want to delete ${customer.name}?`)) return;
    
    if (!ownerId) {
      showToast('error', 'Error', 'User not authenticated');
      return;
    }
    
    setIsProcessing(true);
    try {
      const customerRef = getUserDoc(ownerId, "customers", customer.id);
      await updateDoc(customerRef, {
        isActive: false,
        updatedAt: serverTimestamp(),
      });
      
      showToast('success', 'Deleted', `Customer ${customer.name} has been deleted`);
    } catch (error) {
      console.error(error);
      showToast('error', 'Error', 'Failed to delete customer');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="text-6xl mb-4">🔐</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Authentication Required</h2>
          <p className="text-gray-600 mb-6">Please log in to manage customers.</p>
          <Link 
            href="/login"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-semibold transition-all"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-4 left-4 sm:left-auto z-50 animate-slide-in">
          <div className={`rounded-xl shadow-lg p-4 max-w-md w-full mx-auto sm:mx-0 border ${
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

      {/* Processing Overlay */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[200]">
          <div className="bg-white rounded-2xl p-8 text-center shadow-2xl">
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
              <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center text-xl font-bold">👥</div>
              <div>
                <h1 className="text-2xl font-bold">Customers</h1>
                <p className="text-sm text-gray-300">Manage your customer database</p>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <Link 
                href="/owner-dashboard" 
                className="bg-purple-500 hover:bg-purple-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
              >
                <span>📊</span> Dashboard
              </Link>
              <Link href="/wholesale-sales" className="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all">
                + New Invoice
              </Link>
              <Link href="/credit-list" className="bg-orange-500 hover:bg-orange-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all">
                💳 Credit List
              </Link>
              <Link href="/invoice-management" className="bg-green-500 hover:bg-green-600 px-4 py-2 rounded-lg text-sm font-semibold transition-all">
                📋 Manage Invoices
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Sync Status Bar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className={`inline-block w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
            <span className="text-gray-600">
              {isOnline ? '🟢 Live Sync' : '🔴 Offline Mode'}
            </span>
            {lastSyncTime && (
              <span className="text-gray-400 ml-2">
                Last sync: {lastSyncTime.toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500">
            {ownerId && (
              <span>👤 {authUser?.email} | ID: {ownerId.substring(0, 8)}...</span>
            )}
          </div>
          <div className="text-xs text-green-600">
            🔄 {customers.length} customers in cloud
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-lg p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs md:text-sm">Total Customers</p>
                <p className="text-2xl md:text-3xl font-bold text-gray-900">{customers.length}</p>
              </div>
              <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-100 rounded-full flex items-center justify-center text-xl md:text-2xl">👥</div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-lg p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs md:text-sm">Active Customers</p>
                <p className="text-2xl md:text-3xl font-bold text-green-600">{customers.length}</p>
              </div>
              <div className="w-10 h-10 md:w-12 md:h-12 bg-green-100 rounded-full flex items-center justify-center text-xl md:text-2xl">✅</div>
            </div>
          </div>
          
          <div className="bg-white rounded-xl shadow-lg p-4 md:p-6 col-span-1 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs md:text-sm">Total Credit Outstanding</p>
                <p className="text-2xl md:text-3xl font-bold text-orange-600">
                  {currency.symbol}{customers.reduce((sum, c) => sum + (c.openingBalance || 0), 0).toLocaleString()}
                </p>
              </div>
              <div className="w-10 h-10 md:w-12 md:h-12 bg-orange-100 rounded-full flex items-center justify-center text-xl md:text-2xl">💰</div>
            </div>
          </div>
        </div>

        {/* Add Button */}
        <div className="mb-6">
          <button 
            onClick={() => { 
              setEditingCustomer(null); 
              setName(""); 
              setPhone(""); 
              setAddress(""); 
              setOpeningBalance(""); 
              setShowAddModal(true); 
            }} 
            disabled={!isOnline}
            className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-4 md:px-6 py-2 md:py-3 rounded-xl font-semibold shadow-lg transition-all text-sm md:text-base disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + Add New Customer
          </button>
        </div>

        {/* Customer List */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 md:px-6 py-3 md:py-4 text-left text-xs md:text-sm font-semibold text-gray-700">Customer Name</th>
                  <th className="px-4 md:px-6 py-3 md:py-4 text-left text-xs md:text-sm font-semibold text-gray-700">Phone</th>
                  <th className="px-4 md:px-6 py-3 md:py-4 text-left text-xs md:text-sm font-semibold text-gray-700 hidden md:table-cell">Address</th>
                  <th className="px-4 md:px-6 py-3 md:py-4 text-right text-xs md:text-sm font-semibold text-gray-700">Opening Balance</th>
                  <th className="px-4 md:px-6 py-3 md:py-4 text-right text-xs md:text-sm font-semibold text-gray-700 hidden lg:table-cell">Total Purchases</th>
                  <th className="px-4 md:px-6 py-3 md:py-4 text-center text-xs md:text-sm font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 md:px-6 py-12 text-center text-gray-400">
                      <div className="text-4xl md:text-6xl mb-4">👥</div>
                      <p>No customers found</p>
                      <p className="text-xs md:text-sm mt-1">Click "Add New Customer" to get started</p>
                     </td>
                  </tr>
                ) : (
                  customers.map(customer => (
                    <tr key={customer.id} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="px-4 md:px-6 py-3 md:py-4">
                        <div className="font-semibold text-gray-900 text-sm md:text-base">{customer.name}</div>
                        <div className="text-xs text-gray-500 mt-1 hidden sm:block">ID: {customer.id.slice(0, 8)}</div>
                       </td>
                      <td className="px-4 md:px-6 py-3 md:py-4 text-gray-600 text-sm">{customer.phone || "-"}</td>
                      <td className="px-4 md:px-6 py-3 md:py-4 text-gray-600 text-sm hidden md:table-cell max-w-[200px] truncate">{customer.address || "-"}</td>
                      <td className="px-4 md:px-6 py-3 md:py-4 text-right">
                        <span className={customer.openingBalance && customer.openingBalance > 0 ? 'text-orange-600 font-semibold text-sm md:text-base' : 'text-gray-500 text-sm'}>
                          {customer.openingBalance ? `${currency.symbol}${customer.openingBalance.toLocaleString()}` : "-"}
                        </span>
                       </td>
                      <td className="px-4 md:px-6 py-3 md:py-4 text-right hidden lg:table-cell">
                        <span className="text-blue-600 font-semibold text-sm">
                          {customer.totalPurchases ? `${currency.symbol}${customer.totalPurchases.toLocaleString()}` : "-"}
                        </span>
                       </td>
                      <td className="px-4 md:px-6 py-3 md:py-4 text-center whitespace-nowrap">
                        <button 
                          onClick={() => editCustomer(customer)} 
                          className="text-blue-600 hover:text-blue-800 px-2 md:px-3 py-1 rounded-lg text-xs md:text-sm font-medium transition-colors"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => deleteCustomer(customer)} 
                          className="text-red-600 hover:text-red-800 px-2 md:px-3 py-1 rounded-lg text-xs md:text-sm font-medium transition-colors ml-1 md:ml-2"
                        >
                          Delete
                        </button>
                       </td>
                     </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Info Banner */}
        <div className="mt-6 md:mt-8 bg-blue-50 border border-blue-200 rounded-xl p-3 md:p-4">
          <p className="text-xs md:text-sm text-blue-800">
            <strong>📋 Real-time Sync:</strong> All changes are instantly synced to the cloud and appear on all your devices (mobile, tablet, laptop) automatically. Make sure you're logged in with the same account on all devices.
          </p>
        </div>
      </main>

      {/* Add/Edit Customer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-[90%] sm:max-w-md w-full shadow-2xl mx-auto">
            <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-4 md:p-6 rounded-t-2xl">
              <div className="flex justify-between items-center">
                <h3 className="text-xl md:text-2xl font-bold">{editingCustomer ? '✏️ Edit Customer' : '➕ Add New Customer'}</h3>
                <button 
                  onClick={() => { 
                    setShowAddModal(false); 
                    setEditingCustomer(null); 
                  }} 
                  className="text-2xl md:text-3xl hover:scale-110 transition-transform"
                >
                  ✕
                </button>
              </div>
            </div>
            
            <div className="p-4 md:p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Name *</label>
                <input 
                  type="text" 
                  className="w-full px-3 md:px-4 py-2 md:py-3 border border-gray-300 rounded-xl focus:border-green-500 focus:outline-none transition-all text-sm md:text-base" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Customer name"
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Phone</label>
                <input 
                  type="tel" 
                  className="w-full px-3 md:px-4 py-2 md:py-3 border border-gray-300 rounded-xl focus:border-green-500 focus:outline-none transition-all text-sm md:text-base" 
                  value={phone} 
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone number (optional)"
                />
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Address</label>
                <textarea 
                  className="w-full px-3 md:px-4 py-2 md:py-3 border border-gray-300 rounded-xl focus:border-green-500 focus:outline-none transition-all resize-vertical text-sm md:text-base" 
                  rows={2} 
                  value={address} 
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Address (optional)"
                />
              </div>
              
              {!editingCustomer && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Opening Balance ({currency.symbol})</label>
                  <input 
                    type="number" 
                    className="w-full px-3 md:px-4 py-2 md:py-3 border border-gray-300 rounded-xl focus:border-green-500 focus:outline-none transition-all text-sm md:text-base" 
                    placeholder="0" 
                    value={openingBalance} 
                    onChange={(e) => setOpeningBalance(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    💡 Positive amount means customer already owes you money
                  </p>
                </div>
              )}
              
              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => { 
                    setShowAddModal(false); 
                    setEditingCustomer(null); 
                  }} 
                  className="flex-1 px-3 md:px-4 py-2 md:py-3 border border-gray-300 rounded-xl hover:bg-gray-50 transition-all font-semibold text-sm md:text-base"
                >
                  Cancel
                </button>
                <button 
                  onClick={saveCustomer} 
                  disabled={isProcessing || !isOnline} 
                  className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-3 md:px-4 py-2 md:py-3 rounded-xl font-semibold transition-all disabled:opacity-50 text-sm md:text-base"
                >
                  {isProcessing ? 'Saving...' : (editingCustomer ? 'Update Customer' : 'Create Customer')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @media (max-width: 640px) {
          .animate-slide-in {
            animation: slide-in 0.3s ease-out;
            left: 1rem;
            right: 1rem;
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}