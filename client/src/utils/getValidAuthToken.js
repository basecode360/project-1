// src/utils/getValidAuthToken.js
import apiService from '../api/apiService';
import { userStore } from '../store/authStore';

/**
 * Try to return a valid eBay user‐token (accessToken).
 * 1) If localStorage’s "ebay_user_token" exists and hasn't expired, return it.
 * 2) Otherwise, call GET /auth/token?userId=<userId> if—and only if—the
 *    currently logged‐in user actually exists (which means they used
 *    email+password, but not necessarily connected eBay yet).
 * 3) If backend returns success:{true, auth_token:…}, save it to localStorage
 *    and return it; else return null.
 */
const getValidAuthToken = async () => {
  const { user } = userStore.getState();
  if (!user || !user.id) {
    // Nobody is logged in, so we cannot fetch/refresh an eBay token.
    return null;
  }
  const userId = user.id;

  // 1) Check localStorage for a still‐valid eBay token:
  const raw = localStorage.getItem('ebay_user_token');
  if (raw) {
    try {
      const { value, expiry } = JSON.parse(raw);
      if (typeof expiry === 'number' && Date.now() < expiry && value) {
        // Still valid → return it immediately.
        return value;
      }
      // Expired (or malformed) → fall through to attempt a backend refresh
    } catch (_e) {
      // Bad JSON → ignore, fall through
    }
  }

  // 2) At this point, there is no valid token in localStorage.
  //    Attempt to call our backend:
  let resp;
  try {
    resp = await apiService.auth.getEbayUserToken(userId);
  } catch (err) {
    console.warn('Could not call /auth/token:', err);
    return null;
  }

  // 3) If the backend says “success: true” with a fresh auth_token, store it:
  if (resp && resp.success && typeof resp.auth_token === 'string') {
    const newToken = resp.auth_token;
    const expiresIn = Number(resp.expires_in_seconds) || 0;
    const serverExpiryMs = Date.now() + expiresIn * 1000;
    localStorage.setItem(
      'ebay_user_token',
      JSON.stringify({ value: newToken, expiry: serverExpiryMs })
    );
    return newToken;
  }

  // 4) Otherwise (e.g. resp.success===false), the user has never “connected to eBay” yet.
  //    We must return null—do not keep re‐calling /auth/token on every route.
  return null;
};

export default getValidAuthToken;
