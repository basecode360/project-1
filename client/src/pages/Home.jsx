// src/pages/Home.jsx - OPTIMIZED VERSION WITH FAST AUTH
import React, { useEffect, useState, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import apiService from '../api/apiService';
import getValidAuthToken from '../utils/getValidAuthToken';
import useAuthStore from '../store/authStore';

import Header from '../componentsForHome/Header';
import NavTabs from '../componentsForHome/NavTabs';
import ListingsHeading from '../componentsForHome/ListingsHeading';
import EntriesAndSearchBar from '../componentsForHome/EntriesAndSearchBar';
import ListingsTable from '../componentsForHome/ListingsTable';
import PaginationBar from '../componentsForHome/PaginationBar';
import Footer from '../componentsForHome/Footer';
import ScrollToTopButton from '../componentsForHome/ScrollToTopButton';
import AssignCompetitorRule from '../componentsForHome/AssignCompetitorRule';

// CRITICAL: Lightning-fast auth check to eliminate delays
const lightningFastAuthCheck = () => {
  try {
    const authStore = JSON.parse(localStorage.getItem('auth-store') || '{}');
    const appJwt = localStorage.getItem('app_jwt');
    const userId = localStorage.getItem('user_id');

    console.log('🏠 Home: ⚡ Lightning auth check:', {
      hasAuthStore: !!authStore.state?.user,
      hasAppJwt: !!appJwt,
      hasUserId: !!userId,
    });

    return !!(authStore.state?.user || appJwt || userId);
  } catch (error) {
    console.error('🏠 Home: Lightning auth check error:', error);
    return false;
  }
};

export default function Home({ handleLogout }) {
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [itemsPerPage] = useState(10);
  const [ebayToken, setEbayToken] = useState(null);
  const [needsConnection, setNeedsConnection] = useState(false);
  const [loadingListings, setLoadingListings] = useState(false);
  const [listingsError, setListingsError] = useState(null);

  const user = useAuthStore((store) => store.user);
  const location = useLocation();
  const popupRef = useRef(null);

  // Handle OAuth popup messages
  useEffect(() => {
    const handleMessage = async (event) => {
      // For production, allow messages from the same origin
      if (
        event.origin !== window.location.origin &&
        event.origin !== 'https://17autoparts.com'
      ) {
        console.warn('⚠️ Message from unexpected origin, ignoring');
        return;
      }

      const { code, state, error } = event.data;

      if (error) {
        console.error('❌ OAuth error from popup:', error);
        alert('eBay authorization failed: ' + error);
        return;
      }

      if (code && user?.id) {
        try {
          const resp = await apiService.auth.exchangeCode({
            code,
            userId: user.id,
          });

          if (!resp.success) {
            console.error('❌ Exchange failed:', resp.error);
            alert('Failed to exchange authorization code: ' + resp.error);
            throw new Error(resp.error || 'Exchange failed');
          }

          const expiresIn = resp.data.expires_in || 7200;
          const expiresAt = Date.now() + expiresIn * 1000;

          const tokenData = {
            value: resp.data.access_token,
            expiry: expiresAt,
          };

          localStorage.setItem('ebay_user_token', JSON.stringify(tokenData));
          localStorage.setItem('userId', user.id);

          if (resp.data.refresh_token) {
            localStorage.setItem('ebay_refresh_token', resp.data.refresh_token);
          }

          setEbayToken(resp.data.access_token);
          setNeedsConnection(false);

          if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.close();
          }

          alert('✅ Successfully connected to eBay!');
        } catch (err) {
          console.error('❌ Error exchanging code:', err);
          alert('Error connecting to eBay: ' + err.message);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [user]);

  // CRITICAL: LIGHTNING-FAST token check to eliminate 15+ second delays
  useEffect(() => {
    async function lightningTokenCheck() {
      console.log('🏠 Home: ⚡ Starting LIGHTNING token check at:', Date.now());

      // FAST PATH 1: Check if we have stored auth without waiting for user
      const hasStoredAuth = lightningFastAuthCheck();
      const storedUserId = localStorage.getItem('user_id');

      // FAST PATH 2: Use stored user ID if available, don't wait for user state
      const effectiveUserId = user?.id || storedUserId;

      if (!effectiveUserId) {
        if (hasStoredAuth && storedUserId) {
          console.log(
            '🏠 Home: ⚡ Using stored user ID, not waiting for user state'
          );
          await proceedWithTokenCheck(storedUserId);
          return;
        }

        console.log('🏠 Home: ⏳ No user ID available yet');
        // Don't wait forever - if we can't proceed in 2 seconds, something's wrong
        setTimeout(() => {
          if (!effectiveUserId && hasStoredAuth) {
            console.warn(
              '🏠 Home: ⚠️ Timeout waiting for user, proceeding with stored auth'
            );
            const fallbackUserId = localStorage.getItem('user_id');
            if (fallbackUserId) {
              proceedWithTokenCheck(fallbackUserId);
            }
          }
        }, 2000);
        return;
      }

      await proceedWithTokenCheck(effectiveUserId);
    }

    async function proceedWithTokenCheck(userId) {
      console.log('🏠 Home: ⚡ Lightning token check for user:', userId);

      // STEP 1: Lightning-fast localStorage check
      const localTokenStr = localStorage.getItem('ebay_user_token');
      if (localTokenStr) {
        try {
          const localTokenData = JSON.parse(localTokenStr);
          if (localTokenData.expiry > Date.now()) {
            console.log('🏠 Home: ⚡ INSTANT - Valid token in localStorage');
            setEbayToken(localTokenData.value);
            setNeedsConnection(false);
            return;
          } else {
            console.log('🏠 Home: 🗑️ Removing expired token from localStorage');
            localStorage.removeItem('ebay_user_token');
          }
        } catch (err) {
          console.warn('⚠️ Invalid token data in localStorage, removing...');
          localStorage.removeItem('ebay_user_token');
        }
      }

      // STEP 2: Backend refresh with timeout to prevent delays
      try {
        console.log(
          '🏠 Home: 🔄 Fetching token from backend (with 3s timeout)...'
        );

        const tokenPromise = getValidAuthToken(userId);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Backend token fetch timeout')),
            3000
          )
        );

        const token = await Promise.race([tokenPromise, timeoutPromise]);

        if (token) {
          const tokenData = {
            value: token,
            expiry: Date.now() + 7200 * 1000,
          };
          localStorage.setItem('ebay_user_token', JSON.stringify(tokenData));
          setEbayToken(token);
          setNeedsConnection(false);
          console.log('🏠 Home: ✅ Fresh token obtained from backend');
        } else {
          console.log('🏠 Home: ❌ No token available, needs connection');
          setNeedsConnection(true);
        }
      } catch (err) {
        console.warn('⚠️ Backend token fetch failed/timeout:', err.message);
        console.log(
          '🏠 Home: 🔗 Setting needs connection due to token failure'
        );
        setNeedsConnection(true);
      }
    }

    lightningTokenCheck();
  }, [user]); // Keep user dependency but make it non-blocking with fallbacks

  // OPTIMIZED: Lightning-fast listings fetch
  useEffect(() => {
    if (!ebayToken) {
      console.log('🏠 Home: ⏳ No eBay token yet, skipping listings fetch');
      return;
    }

    async function lightningFetchListings() {
      console.log('🏠 Home: ⚡ Starting LIGHTNING listings fetch...');
      setLoadingListings(true);
      setListingsError(null);

      try {
        const data = await apiService.inventory.getActiveListings();

        if (!data.success) {
          // Check if token expired
          if (data.errors?.[0]?.errorId === 932) {
            console.warn('eBay token expired. Refreshing…');

            const effectiveUserId = user?.id || localStorage.getItem('user_id');
            if (effectiveUserId) {
              const refreshed = await apiService.auth.refreshEbayUserToken(
                effectiveUserId
              );

              if (refreshed?.success && refreshed.data?.access_token) {
                const expires = refreshed.data.expires_in || 7200;
                localStorage.setItem(
                  'ebay_user_token',
                  JSON.stringify({
                    value: refreshed.data.access_token,
                    expiry: Date.now() + expires * 1000,
                  })
                );
                setEbayToken(refreshed.data.access_token);
                return; // re-trigger on next effect run
              }
            }

            // Refresh failed, clear tokens and show connect page
            localStorage.removeItem('ebay_user_token');
            localStorage.removeItem('ebay_refresh_token');
            setEbayToken(null);
            setNeedsConnection(true);
            return;
          }
          setListingsError(data.error || 'Failed to load listings.');
        }

        console.log('🏠 Home: ✅ Listings fetch completed successfully');
      } catch (err) {
        console.error('Error fetching listings:', err);

        // Check if it's a 401 error (token expired)
        if (err.response?.status === 401 || err.status === 401) {
          console.warn(
            '⚠️ eBay token expired (401 error). Clearing tokens and showing connect page.'
          );
          localStorage.removeItem('ebay_user_token');
          localStorage.removeItem('ebay_refresh_token');
          setEbayToken(null);
          setNeedsConnection(true);
          setListingsError(null);
        } else {
          setListingsError(err.message || 'Error loading listings.');
        }
      } finally {
        setLoadingListings(false);
      }
    }

    lightningFetchListings();
  }, [ebayToken, user]);

  // Handle global eBay token expiry events
  useEffect(() => {
    const handleTokenExpiry = () => {
      console.warn('eBay token expired event received');
      setEbayToken(null);
      setNeedsConnection(true);
      setListingsError(null);
    };

    const handleAuthFailure = () => {
      console.warn(
        '⚠️ Authentication failure detected. Clearing storage and reloading...'
      );

      localStorage.removeItem('user-store');
      localStorage.removeItem('ebay_user_token');
      localStorage.removeItem('ebay_refresh_token');
      localStorage.removeItem('userId');
      localStorage.removeItem('user_id');

      window.location.reload();
    };

    window.addEventListener('ebayTokenExpired', handleTokenExpiry);
    window.addEventListener('authenticationFailed', handleAuthFailure);

    return () => {
      window.removeEventListener('ebayTokenExpired', handleTokenExpiry);
      window.removeEventListener('authenticationFailed', handleAuthFailure);
    };
  }, []);

  // 3) If the user never connected to eBay, show "Connect to eBay" UI.
  if (needsConnection) {
    const openEbayOAuthPopup = () => {
      const effectiveUserId = user?.id || localStorage.getItem('user_id');

      if (!effectiveUserId) {
        console.error('No user ID available – cannot start eBay OAuth.');
        alert('No user ID available. Please log in again.');
        return;
      }

      const backendBase =
        import.meta.env.VITE_BACKEND_URL || window.location.origin;
      const width = 600;
      const height = 700;
      const left = window.screenX + (window.innerWidth - width) / 2;
      const top = window.screenY + (window.innerHeight - height) / 2;

      const authUrl = `${backendBase}/auth/ebay-login?userId=${effectiveUserId}`;

      const popup = window.open(
        authUrl,
        'ebayAuth',
        `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,resizable=yes`
      );

      if (!popup) {
        console.error('❌ Failed to open popup - might be blocked');
        alert(
          'Popup was blocked. Please allow popups for this site and try again.'
        );
        return;
      }

      popupRef.current = popup;

      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
        }
      }, 1000);
    };

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <h2>eBay Token Expired</h2>
        <p style={{ marginBottom: '2rem', color: '#666' }}>
          Your eBay authorization has expired. Please reconnect your eBay
          account to continue.
        </p>
        <button
          onClick={openEbayOAuthPopup}
          style={{
            padding: '1rem 2rem',
            backgroundColor: '#2E3B4E',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '1rem',
            cursor: 'pointer',
            marginBottom: '1rem',
          }}
        >
          Reconnect to eBay
        </button>
        <button
          onClick={() => {
            setNeedsConnection(false);
            setEbayToken('dummy');
          }}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: 'transparent',
            color: '#666',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          Try Again
        </button>
      </div>
    );
  }

  // Handle eBay account logout
  const handleEbayLogout = async () => {
    const effectiveUserId = user?.id || localStorage.getItem('user_id');
    if (!effectiveUserId) return;

    try {
      const response = await apiService.auth.ebayLogout(effectiveUserId);

      if (response.success) {
        localStorage.removeItem('ebay_user_token');
        localStorage.removeItem('ebay_refresh_token');
        setEbayToken(null);
        setNeedsConnection(true);
        setListingsError(null);
      } else {
        console.error('Failed to logout from eBay:', response.error);
        setListingsError('Failed to disconnect eBay account');
      }
    } catch (error) {
      console.error('Error during eBay logout:', error);
      setListingsError('Error disconnecting eBay account');
    }
  };

  // 4) Normal dashboard rendering once we have "ebayToken"
  const isDashboard = location.pathname === '/home';
  const isCompetitors = location.pathname === '/home/competitors';
  const isPricingStrategies = location.pathname === '/home/pricing-strategies';
  const isPriceStrategy = location.pathname.startsWith('/home/price-strategy/');

  // Reset to page 1 when switching views or reloading data
  const handleTotalPagesChange = (newTotalPages) => {
    setTotalPages(newTotalPages);
    if (page > newTotalPages) {
      setPage(1);
    }
  };

  return (
    <>
      <Header handleLogout={handleLogout} handleEbayLogout={handleEbayLogout} />
      <NavTabs />

      <Outlet />

      {isDashboard && (
        <>
          <ListingsHeading />
          {loadingListings ? (
            <p style={{ textAlign: 'center', marginTop: '2rem' }}>
              Loading your eBay listings…⏳
            </p>
          ) : listingsError ? (
            <p style={{ textAlign: 'center', marginTop: '2rem', color: 'red' }}>
              Error loading listings: {listingsError}
            </p>
          ) : (
            <>
              <EntriesAndSearchBar />
              <ListingsTable
                currentPage={page}
                itemsPerPage={itemsPerPage}
                onTotalPagesChange={handleTotalPagesChange}
                mode="listings"
              />
              <PaginationBar
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </>
          )}
        </>
      )}

      <Footer />
      <ScrollToTopButton />
    </>
  );
}
