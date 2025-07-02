// src/hooks/useAuth.js - OPTIMIZED VERSION WITH FAST AUTH
import { useEffect, useState } from 'react';
import useAuthStore, { waitForHydration } from '../store/authStore';

export const useAuth = () => {
  const [loading, setLoading] = useState(true);

  // Get all auth state from Zustand store
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const _hasHydrated = useAuthStore((state) => state._hasHydrated);
  const setHasHydrated = useAuthStore((state) => state.setHasHydrated);

  // CRITICAL: Fast-track authentication check to eliminate 20-second delay
  useEffect(() => {
    console.log(
      '🔐 useAuth: Starting LIGHTNING-FAST auth check at:',
      Date.now()
    );

    const lightningFastAuth = () => {
      try {
        // Immediate localStorage check without any delays
        const authStore = JSON.parse(
          localStorage.getItem('auth-store') || '{}'
        );
        const appJwt = localStorage.getItem('app_jwt');
        const userId = localStorage.getItem('user_id');

        console.log('🔐 useAuth: Lightning check results:', {
          hasAuthStore: !!authStore.state?.user,
          hasAppJwt: !!appJwt,
          hasUserId: !!userId,
          storeUser: !!user,
          storeToken: !!token,
          storeHydrated: _hasHydrated,
        });

        // If we have ANY auth indication, stop loading immediately
        if (authStore.state?.user || appJwt || user || token || userId) {
          console.log(
            '🔐 useAuth: ⚡ INSTANT auth success - stopping loading NOW'
          );
          setLoading(false);
          setHasHydrated(true);
          return true;
        }

        return false;
      } catch (error) {
        console.error('🔐 useAuth: Lightning check error:', error);
        return false;
      }
    };

    // Execute lightning fast check immediately
    const hasAuth = lightningFastAuth();

    if (!hasAuth) {
      // If no immediate auth found, wait VERY briefly then stop anyway
      console.log('🔐 useAuth: No immediate auth - setting MINIMAL timeout');
      const timeout = setTimeout(() => {
        console.log(
          '🔐 useAuth: ⚡ TIMEOUT (800ms) - stopping loading to prevent delays'
        );
        setLoading(false);
        setHasHydrated(true);
      }, 800); // Only 800ms maximum wait instead of 3+ seconds!

      return () => clearTimeout(timeout);
    }
  }, [user, token, _hasHydrated, setHasHydrated]);

  // INSTANT response when user/token appears
  useEffect(() => {
    if (user || token) {
      console.log(
        '🔐 useAuth: ⚡ INSTANT user/token detected - stopping loading'
      );
      setLoading(false);
      setHasHydrated(true);
    }
  }, [user, token, setHasHydrated]);

  // EMERGENCY brake - never let loading exceed 1 second total
  useEffect(() => {
    const emergencyTimeout = setTimeout(() => {
      if (loading) {
        console.warn(
          '🔐 useAuth: 🚨 EMERGENCY STOP - Force stopping loading after 1 second'
        );
        setLoading(false);
        setHasHydrated(true);
      }
    }, 1000); // Hard limit: 1 second maximum

    return () => clearTimeout(emergencyTimeout);
  }, [loading, setHasHydrated]);

  const authState = {
    user,
    token,
    loading,
    isAuthenticated: isAuthenticated || (!!user && !!token),
    _hasHydrated,
    login: useAuthStore.getState().setUser,
    logout: useAuthStore.getState().logout,
  };

  console.log('🔐 useAuth LIGHTNING state:', {
    loading: authState.loading,
    hasUser: !!authState.user,
    hasToken: !!authState.token,
    isAuthenticated: authState.isAuthenticated,
    timestamp: Date.now(),
  });

  return authState;
};

// Remove AuthProvider - we don't need it with Zustand
export const AuthProvider = ({ children }) => {
  console.log('⚠️  AuthProvider is deprecated, remove this wrapper');
  return children;
};

export default useAuth;
