import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "./firebase";
import { doc, getDoc } from "firebase/firestore";
import { restorePOSSession, extendPOSSession } from "./auth"; // NEW: Import session helpers

export const withRole = (allowedRole: string, Component: any) => {
  return () => {
    const [role, setRole] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
      const checkRole = async () => {
        // 🚀 NEW: 1. Check 12hr session first (FASTEST)
        const session = restorePOSSession();
        if (session && session.role === allowedRole) {
          extendPOSSession(); // Keep session alive
          setRole(session.role);
          setLoading(false);
          return;
        }

        // 2. Fallback to Firebase check (your original logic)
        const user = auth.currentUser;
        if (!user) {
          // NEW: Session might still be valid - check before redirect
          if (!session) return router.push("/login");
          return; // Session exists, wait for Firebase reconnect
        }

        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.data();
        if (!userData) return router.push("/login");

        if (userData.role !== allowedRole) return router.push("/login");

        // NEW: Extend session on successful Firebase check
        extendPOSSession();

        setRole(userData.role);
        setLoading(false);
      };
      
      checkRole();
    }, []);

    if (loading) return <p>Loading...</p>;
    if (!role) return <p>Access denied</p>;
    
    return <Component />;
  };
};