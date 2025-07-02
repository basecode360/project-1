// src/store/authStore.js - OPTIMIZED VERSION WITH LIGHTNING-FAST HYDRATION
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const useAuthStore = create(
  persist(
    (set, get) => ({
      // Auth state
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      _hasHydrated: false, // Track hydration state

      // eBay connection state
      ebayConnected: false,
      ebayToken: null,
      ebayTokenExpires: null,

      // Actions
      setUser: (user) => {
        console.log('🔐 AuthStore: Setting user:', {
          id: user?.id,
          email: user?.email,
        });
        set({
          user,
          isAuthenticated: !!user,
          _hasHydrated: true, // Mark as hydrated when user is set
        });
      },

      setToken: (token) => {
        console.log('🔐 AuthStore: Setting token:', !!token);
        set({
          token,
          isAuthenticated: !!token,
          _hasHydrated: true, // Mark as hydrated when token is set
        });
      },

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error }),

      setEbayConnection: (connected, token = null, expires = null) =>
        set({
          ebayConnected: connected,
          ebayToken: token,
          ebayTokenExpires: expires,
        }),

      // Set hydration status
      setHasHydrated: (hasHydrated) => {
        console.log('🔐 AuthStore: ⚡ FORCE Hydration status:', hasHydrated);
        set({ _hasHydrated: hasHydrated });
      },

      // Login action
      login: async (email, password) => {
        set({ isLoading: true, error: null });

        try {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
          });

          const data = await response.json();

          if (data.success) {
            set({
              user: data.user,
              token: data.token,
              isAuthenticated: true,
              isLoading: false,
              error: null,
              _hasHydrated: true,
            });
            return { success: true };
          } else {
            set({
              error: data.message,
              isLoading: false,
            });
            return { success: false, error: data.message };
          }
        } catch (error) {
          const errorMessage = 'Login failed. Please try again.';
          set({
            error: errorMessage,
            isLoading: false,
          });
          return { success: false, error: errorMessage };
        }
      },

      // Register action
      register: async (email, password) => {
        set({ isLoading: true, error: null });

        try {
          const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
          });

          const data = await response.json();

          if (data.success) {
            set({
              user: data.user,
              token: data.token,
              isAuthenticated: true,
              isLoading: false,
              error: null,
              _hasHydrated: true,
            });
            return { success: true };
          } else {
            set({
              error: data.message,
              isLoading: false,
            });
            return { success: false, error: data.message };
          }
        } catch (error) {
          const errorMessage = 'Registration failed. Please try again.';
          set({
            error: errorMessage,
            isLoading: false,
          });
          return { success: false, error: errorMessage };
        }
      },

      // Logout action
      logout: () => {
        console.log('🔐 AuthStore: Logging out');
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          ebayConnected: false,
          ebayToken: null,
          ebayTokenExpires: null,
          error: null,
          _hasHydrated: true,
        });

        // Clear localStorage
        localStorage.removeItem('app_jwt');
        localStorage.removeItem('user_id');
        localStorage.removeItem('ebay_user_token');
        localStorage.removeItem('ebay_refresh_token');
      },

      // Check if user is authenticated
      checkAuth: () => {
        const { token, user } = get();
        return !!(token && user);
      },

      // Clear error
      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-store', // localStorage key
      storage: createJSONStorage(() => localStorage), // Use createJSONStorage for better performance

      // CRITICAL: Lightning-fast rehydration callbacks
      onRehydrateStorage: () => {
        console.log(
          '🔐 AuthStore: ⚡ Starting LIGHTNING rehydration at:',
          Date.now()
        );
        return (state, error) => {
          const endTime = Date.now();
          if (error) {
            console.error('🔐 AuthStore: Rehydration failed:', error);
            // On error, mark as hydrated anyway to prevent infinite loading
            useAuthStore.getState().setHasHydrated(true);
          } else {
            console.log(
              '🔐 AuthStore: ⚡ LIGHTNING rehydration completed at:',
              endTime
            );
            console.log('🔐 AuthStore: Rehydrated state:', {
              hasUser: !!state?.user,
              hasToken: !!state?.token,
              isAuthenticated: state?.isAuthenticated,
            });
            // Mark as hydrated immediately
            if (state) state._hasHydrated = true;
          }
        };
      },

      // Only persist essential auth data
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        ebayConnected: state.ebayConnected,
        ebayToken: state.ebayToken,
        ebayTokenExpires: state.ebayTokenExpires,
      }),

      skipHydration: false, // We want hydration, but FAST

      // Handle migration/version changes
      version: 1,
      migrate: (persistedState, version) => {
        console.log('🔐 AuthStore: Migrating from version:', version);
        if (version === 0) {
          // Migration logic if needed
        }
        return persistedState;
      },
    }
  )
);

// CRITICAL: LIGHTNING-FAST hydration with minimal timeout
const lightningHydration = () => {
  console.log('🔐 AuthStore: ⚡ Starting lightning hydration check...');

  // Force hydration to complete after just 400ms instead of 2+ seconds!
  const lightningTimeout = setTimeout(() => {
    const state = useAuthStore.getState();
    if (!state._hasHydrated) {
      console.warn(
        '🔐 AuthStore: ⚡ LIGHTNING FORCE completing hydration after 400ms'
      );
      useAuthStore.getState().setHasHydrated(true);
    }
  }, 400); // Super fast 400ms timeout!

  return () => clearTimeout(lightningTimeout);
};

// Start lightning hydration immediately when store is imported
lightningHydration();

// Export a lightning-fast hydration status checker
export const waitForHydration = async (maxWaitTime = 800) => {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const state = useAuthStore.getState();
      const elapsed = Date.now() - startTime;

      if (state._hasHydrated || elapsed > maxWaitTime) {
        clearInterval(checkInterval);
        console.log(
          `🔐 AuthStore: ⚡ LIGHTNING hydration wait completed in ${elapsed}ms`
        );
        resolve(state._hasHydrated);
      }
    }, 25); // Check every 25ms for faster response
  });
};

export default useAuthStore;
