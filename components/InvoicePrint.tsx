"use client";

import { useRef } from "react";

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

interface InvoicePrintProps {
  invoice: Invoice;
  shopName: string;
  currency: { symbol: string; code: string };
  onClose?: () => void;
}

export default function InvoicePrint({ invoice, shopName, currency, onClose }: InvoicePrintProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const calculateItemTotal = (item: CartItem) => {
    return item.price * item.qty;
  };

  const formatDate = (date: any) => {
    if (date?.toDate) {
      const d = new Date(date.toDate());
      return d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    if (date instanceof Date) {
      return date.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    return new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const originalTitle = document.title;
    document.title = `Invoice ${invoice.invoiceNumber}`;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow pop-ups to print invoices');
      return;
    }

    const allItemsHtml = invoice.items.map(item => {
      const itemTotal = calculateItemTotal(item);
      const nameDisplay = item.name.length > 25 ? item.name.substring(0, 22) + '...' : item.name;
      
      return `
        <tr>
          <td class="item-name">${nameDisplay}</td>
          <td class="text-center">${item.qty}</td>
          <td class="text-right">${currency.symbol}${item.price.toLocaleString()}</td>
          <td class="text-right">${currency.symbol}${Math.round(itemTotal).toLocaleString()}</td>
        </tr>
      `;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invoice ${invoice.invoiceNumber}</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Courier New', 'Monaco', 'Menlo', monospace;
            background: #f5f5f5;
            padding: 40px 20px;
            font-size: 12px;
            line-height: 1.45;
          }
          
          .invoice-container {
            max-width: 350px;
            margin: 0 auto;
            background: white;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1);
          }
          
          .invoice {
            padding: 20px;
          }
          
          /* Header */
          .header {
            text-align: center;
            margin-bottom: 20px;
            padding-bottom: 12px;
            border-bottom: 1px dashed #ccc;
          }
          
          .shop-name {
            font-size: 18px;
            font-weight: bold;
            letter-spacing: 1px;
            margin-bottom: 4px;
          }
          
          .invoice-title {
            font-size: 12px;
            font-weight: bold;
            letter-spacing: 1px;
            color: #555;
            margin-top: 6px;
          }
          
          .invoice-details {
            display: flex;
            justify-content: space-between;
            margin-top: 8px;
            font-size: 10px;
            color: #666;
          }
          
          /* Customer Section */
          .customer-section {
            margin: 16px 0;
            padding: 10px;
            background: #f9fafb;
            border-left: 3px solid #3b82f6;
            font-size: 10px;
          }
          
          .customer-name {
            font-weight: bold;
            font-size: 11px;
            margin-bottom: 4px;
          }
          
          .customer-detail {
            color: #6b7280;
            margin-top: 2px;
          }
          
          /* Items Table */
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin: 16px 0;
          }
          
          .items-table th {
            text-align: left;
            padding: 8px 4px;
            border-bottom: 1px solid #e5e7eb;
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #6b7280;
          }
          
          .items-table td {
            padding: 8px 4px;
            border-bottom: 1px solid #f0f0f0;
            font-size: 11px;
          }
          
          .item-name {
            font-weight: 500;
          }
          
          .text-center {
            text-align: center;
          }
          
          .text-right {
            text-align: right;
          }
          
          /* Totals Section */
          .totals {
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1px dashed #e5e7eb;
          }
          
          .total-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 6px;
            font-size: 10px;
          }
          
          .grand-total {
            display: flex;
            justify-content: space-between;
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #e5e7eb;
            font-weight: bold;
            font-size: 13px;
          }
          
          .balance-row {
            display: flex;
            justify-content: space-between;
            margin-top: 8px;
            padding-top: 6px;
            border-top: 1px dashed #e5e7eb;
            color: #f97316;
            font-weight: bold;
          }
          
          /* Footer */
          .footer {
            text-align: center;
            margin-top: 24px;
            padding-top: 12px;
            border-top: 1px dashed #e5e7eb;
            font-size: 9px;
            color: #9ca3af;
          }
          
          .footer p {
            margin: 2px 0;
          }
          
          .powered-by {
            margin-top: 6px;
            font-size: 8px;
          }
          
          /* Notes */
          .notes {
            margin-top: 12px;
            padding: 8px;
            background: #fefce8;
            border-left: 2px solid #eab308;
            font-size: 9px;
            color: #713f12;
          }
          
          /* Print Styles */
          @media print {
            body {
              background: white;
              padding: 0;
              margin: 0;
            }
            .invoice-container {
              box-shadow: none;
              max-width: 100%;
            }
            .no-print {
              display: none;
            }
          }
          
          /* Mobile */
          @media (max-width: 480px) {
            body {
              padding: 20px 10px;
            }
            .invoice {
              padding: 15px;
            }
            .items-table th,
            .items-table td {
              font-size: 9px;
              padding: 6px 2px;
            }
          }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <div class="invoice">
            <!-- Header -->
            <div class="header">
              <div class="shop-name">${shopName || 'AB TRADERS'}</div>
              <div class="invoice-title">SALE INVOICE</div>
              <div class="invoice-details">
                <span>Invoice #: ${invoice.invoiceNumber}</span>
                <span>Date: ${formatDate(invoice.createdAt)}</span>
              </div>
            </div>
            
            <!-- Customer Information -->
            <div class="customer-section">
              <div class="customer-name">${invoice.customerName}</div>
              ${invoice.customerPhone ? `<div class="customer-detail">📞 ${invoice.customerPhone}</div>` : ''}
              ${invoice.customerAddress ? `<div class="customer-detail">📍 ${invoice.customerAddress}</div>` : ''}
            </div>
            
            <!-- Items Table -->
            <table class="items-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th class="text-center">Qty</th>
                  <th class="text-right">Price</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${allItemsHtml}
              </tbody>
            </table>
            
            <!-- Totals -->
            <div class="totals">
              <div class="total-row">
                <span>Subtotal:</span>
                <span>${currency.symbol}${Math.round(invoice.subtotal).toLocaleString()}</span>
              </div>
              ${invoice.discount > 0 ? `
                <div class="total-row">
                  <span>Discount:</span>
                  <span>-${currency.symbol}${Math.round(invoice.discount).toLocaleString()}</span>
                </div>
              ` : ''}
              <div class="grand-total">
                <span>Total:</span>
                <span>${currency.symbol}${Math.round(invoice.total).toLocaleString()}</span>
              </div>
              <div class="total-row">
                <span>Paid:</span>
                <span>${currency.symbol}${Math.round(invoice.paid).toLocaleString()}</span>
              </div>
              ${invoice.balance > 0 ? `
                <div class="balance-row">
                  <span>Balance Due:</span>
                  <span>${currency.symbol}${Math.round(invoice.balance).toLocaleString()}</span>
                </div>
              ` : ''}
            </div>
            
            <!-- Notes -->
            ${invoice.notes ? `
              <div class="notes">
                <strong>Note:</strong> ${invoice.notes}
              </div>
            ` : ''}
            
            <!-- Footer -->
            <div class="footer">
              <p>Thank you for your business!</p>
              <div class="powered-by">Powered by Stockaro</div>
            </div>
          </div>
        </div>
        
        <!-- Print Controls -->
        <div class="no-print" style="text-align:center; margin-top:20px; max-width:350px; margin-left:auto; margin-right:auto;">
          <button onclick="window.print()" style="padding:10px 20px; margin:0 5px; background:#3b82f6; color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px;">🖨️ Print</button>
          <button onclick="window.close()" style="padding:10px 20px; background:#6b7280; color:white; border:none; border-radius:8px; cursor:pointer; font-size:12px;">Close</button>
        </div>
        
        <script>
          window.onload = () => {
            setTimeout(() => {
              window.print();
            }, 300);
          };
        </script>
      </body>
      </html>
    `);
    
    printWindow.document.close();
    document.title = originalTitle;
    
    if (onClose) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-6">
          <div className="flex justify-between items-center">
            <h3 className="text-2xl font-bold">✅ Invoice Ready</h3>
            <button 
              onClick={onClose} 
              className="text-3xl hover:scale-110 transition-transform"
            >
              ✕
            </button>
          </div>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {/* Preview */}
          <div ref={printRef} className="bg-white border rounded-xl p-4 mb-6">
            <div className="text-center border-b pb-3 mb-3">
              <div className="font-bold text-lg">{shopName || 'AB TRADERS'}</div>
              <div className="text-sm font-bold mt-1">SALE INVOICE</div>
              <div className="text-xs text-gray-600">#{invoice.invoiceNumber}</div>
              <div className="text-xs text-gray-600">{formatDate(invoice.createdAt)}</div>
            </div>
            
            <div className="bg-gray-50 p-3 rounded-lg mb-3 text-sm">
              <div className="font-semibold">{invoice.customerName}</div>
              {invoice.customerPhone && <div className="text-xs text-gray-600">📞 {invoice.customerPhone}</div>}
              {invoice.customerAddress && <div className="text-xs text-gray-600">📍 {invoice.customerAddress}</div>}
            </div>
            
            <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
              {invoice.items.slice(0, 5).map((item, idx) => (
                <div key={idx} className="flex justify-between text-sm border-b pb-1">
                  <div>
                    <span>{item.name}</span>
                    <span className="text-xs text-gray-500 ml-2">x{item.qty}</span>
                  </div>
                  <div>{currency.symbol}{Math.round(item.price * item.qty).toLocaleString()}</div>
                </div>
              ))}
              {invoice.items.length > 5 && (
                <div className="text-xs text-gray-500 text-center">+ {invoice.items.length - 5} more items</div>
              )}
            </div>
            
            <div className="border-t pt-2 space-y-1 text-right text-sm">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{currency.symbol}{Math.round(invoice.subtotal).toLocaleString()}</span>
              </div>
              {invoice.discount > 0 && (
                <div className="flex justify-between">
                  <span>Discount:</span>
                  <span className="text-green-600">-{currency.symbol}{Math.round(invoice.discount).toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Total:</span>
                <span className="font-bold">{currency.symbol}{Math.round(invoice.total).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Paid:</span>
                <span className="text-green-600">{currency.symbol}{Math.round(invoice.paid).toLocaleString()}</span>
              </div>
              {invoice.balance > 0 && (
                <div className="flex justify-between text-orange-600">
                  <span>Balance Due:</span>
                  <span className="font-semibold">{currency.symbol}{Math.round(invoice.balance).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={handlePrint}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl font-semibold transition-all"
            >
              🖨️ Print Invoice
            </button>
            <button
              onClick={onClose}
              className="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-3 rounded-xl font-semibold transition-all"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}