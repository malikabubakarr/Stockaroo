"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  addDoc,
} from "firebase/firestore";

export default function POSPage() {
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => {
    const fetchProducts = async () => {
      const snapshot = await getDocs(collection(db, "products"));
      const list = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setProducts(list);
    };

    fetchProducts();
  }, []);

  const handleSell = async (product: any) => {
    const quantity = 1;

    if (product.stock <= 0) return alert("Out of stock");

    await updateDoc(doc(db, "products", product.id), {
      stock: product.stock - quantity,
    });

    const profit =
      (product.salePrice - product.costPrice) * quantity;

    await addDoc(collection(db, "sales"), {
      productId: product.id,
      quantity,
      profit,
      timestamp: new Date(),
    });

    alert("Sold");
    window.location.reload();
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">POS</h2>

      {products.map((product) => (
        <div
          key={product.id}
          className="border p-3 mb-3 rounded flex justify-between"
        >
          <div>
            <h3 className="font-bold">{product.name}</h3>
            <p>Stock: {product.stock}</p>
          </div>

          <button
            onClick={() => handleSell(product)}
            className="bg-green-600 text-white px-4 rounded"
          >
            Sell 1
          </button>
        </div>
      ))}
    </div>
  );
}