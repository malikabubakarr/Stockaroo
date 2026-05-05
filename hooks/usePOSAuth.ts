// hooks/usePOSAuth.ts
import { useEffect, useCallback, useState } from 'react';
import { 
  restorePOSSession, 
  extendPOSSession, 
  clearPOSSession,
  login as loginUser 
} from '@/lib/auth';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

interface POSSession {
  uid: string;
  role: string;
  branchId: string;
  name: string;
  startTime: number;
  expiresAt: number;
  lastActivity: number;
}

export const usePOSAuth = () => {
  const [session, setSession] = useState<POSSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [firebaseUser, setFirebaseUser] = useState<any>(null);

  // Restore session on mount
  useEffect(() => {
    const posSession = restorePOSSession();
    setSession(posSession);
    setLoading(false);
  }, []);

  // Listen to Firebase auth changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      
      // If Firebase signs out, clear POS session
      if (!user) {
        clearPOSSession();
        setSession(null);
      }
    });
    return unsubscribe;
  }, []);

  // Auto-extend session every 5 minutes
  useEffect(() => {
    if (!session) return;

    const extendInterval = setInterval(() => {
      const extended = extendPOSSession();
      if (!extended) {
        setSession(null);
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(extendInterval);
  }, [session]);

  // Extend on user activity (mousemove, keydown, etc.)
  const extendOnActivity = useCallback(() => {
    if (session) {
      extendPOSSession();
    }
  }, [session]);

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'scroll', 'click'];
    events.forEach(event => {
      document.addEventListener(event, extendOnActivity, { passive: true });
    });
    
    return () => {
      events.forEach(event => {
        document.removeEventListener(event, extendOnActivity);
      });
    };
  }, [extendOnActivity]);

  const login = async (email: string, password: string) => {
    try {
      setLoading(true);
      const result = await loginUser(email, password);
      const posSession = restorePOSSession(); // Will be created by loginUser
      setSession(posSession);
      return result;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await firebaseSignOut(auth);
      clearPOSSession();
      setSession(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return {
    session,
    firebaseUser,
    loading,
    login,
    logout,
    isAuthenticated: !!session,
    isAdmin: session?.role === 'admin'
  };
};