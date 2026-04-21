"use client"

import { createContext, useContext, useState, ReactNode, useEffect } from "react";

export interface Branch {
  id: string;
  shopName: string;
  ownerId: string;
  isMain?: boolean;
  currency: string;
  currencySymbol?: string;
  location?: string;  // ← CHANGE THIS to optional string, not JSX.Element
  branchNumber?: number;  // ← ADD THIS
}

interface BranchContextType {
  activeBranch: Branch | null;
  setActiveBranch: (branch: Branch | null) => void;
  clearBranch: () => void;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
  const [activeBranch, setActiveBranchState] = useState<Branch | null>(null);

  // Load branch from localStorage on mount
  useEffect(() => {
    const storedBranch = localStorage.getItem("activeBranch");
    if (storedBranch) {
      try {
        const parsed = JSON.parse(storedBranch);
        if (parsed && parsed.id && parsed.shopName) {
          setActiveBranchState(parsed);
        }
      } catch (err) {
        console.error("Failed to parse activeBranch from localStorage", err);
        localStorage.removeItem("activeBranch");
      }
    }
  }, []);

  // Save branch to localStorage whenever it changes
  const setActiveBranch = (branch: Branch | null) => {
    setActiveBranchState(branch);
    if (branch) {
      localStorage.setItem("activeBranch", JSON.stringify(branch));
    } else {
      localStorage.removeItem("activeBranch");
    }
  };

  const clearBranch = () => setActiveBranch(null);

  return (
    <BranchContext.Provider value={{ activeBranch, setActiveBranch, clearBranch }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error("useBranch must be used within a BranchProvider");
  }
  return context;
}