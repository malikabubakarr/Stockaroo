"use client";

import { useState } from "react";
import InvoicePrint from "./InvoicePrint";

interface CartItem {
  id: string;
  name: string;
  qty: number;
  price: number;
  regularPrice?: number;
  purchaseRate?: number;
  isPriceOverridden?: boolean;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
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

interface InvoicePrintButtonProps {
  invoice: Invoice;
  shopName: string;
  currency: { symbol: string; code: string };
  buttonText?: string;
  buttonClassName?: string;
  onPrintSuccess?: () => void;
}

export default function InvoicePrintButton({ 
  invoice, 
  shopName, 
  currency, 
  buttonText = "🖨️ Print Invoice",
  buttonClassName = "px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-semibold transition-all shadow-md",
  onPrintSuccess
}: InvoicePrintButtonProps) {
  const [showPrintModal, setShowPrintModal] = useState(false);

  const handlePrintClick = () => {
    setShowPrintModal(true);
  };

  const handleCloseModal = () => {
    setShowPrintModal(false);
    if (onPrintSuccess) {
      onPrintSuccess();
    }
  };

  return (
    <>
      <button
        onClick={handlePrintClick}
        className={buttonClassName}
        type="button"
      >
        {buttonText}
      </button>
      
      {showPrintModal && (
        <InvoicePrint
          invoice={invoice}
          shopName={shopName}
          currency={currency}
          onClose={handleCloseModal}
        />
      )}
    </>
  );
}