import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "./firebase";
import { doc, getDoc } from "firebase/firestore";

export const withRole = (allowedRole: string, Component: any) => {
  return () => {
    const [role, setRole] = useState<string | null>(null);
    const router = useRouter();

    useEffect(() => {
      const checkRole = async () => {
        const user = auth.currentUser;
        if (!user) return router.push("/login");

        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.data();
        if (!userData) return router.push("/login");

        if (userData.role !== allowedRole) return router.push("/login");

        setRole(userData.role);
      };
      checkRole();
    }, []);

    if (!role) return <p>Loading...</p>;
    return <Component />;
  };
};