// src/api/apiService.js
import axios from 'axios';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
const API_KEY = import.meta.env.VITE_X_API_KEY;

/** ——————————— CACHING AND REQUEST DEDUPLICATION ——————————— **/
class RequestCache {
  constructor() {
    this.cache = new Map();
    this.pendingRequests = new Map();
    this.CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    this.SHORT_CACHE_DURATION = 30 * 1000; // 30 seconds for frequently changing data
  }

  getCacheKey(endpoint, params = {}) {
    return `${endpoint}_${JSON.stringify(params)}`;
  }

  isCacheValid(cacheKey, customDuration = null) {
    const cached = this.cache.get(cacheKey);
    if (!cached) return false;
    
    const duration = customDuration || this.CACHE_DURATION;
    const isValid = Date.now() - cached.timestamp < duration;
    
    if (!isValid) {
      this.cache.delete(cacheKey);
    }
    return isValid;
  }

  setCacheValue(cacheKey, data, customDuration = null) {
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
      duration: customDuration || this.CACHE_DURATION
    });
  }

  getCacheValue(cacheKey) {
    const cached = this.cache.get(cacheKey);
    return cached ? cached.data : null;
  }

  // Request deduplication - prevent multiple identical requests
  async deduplicate(cacheKey, requestFunction) {
    // Check if same request is already in flight
    if (this.pendingRequests.has(cacheKey)) {
      console.log(`🔄 Deduplicating request: ${cacheKey}`);
      return this.pendingRequests.get(cacheKey);
    }

    // Execute request and store promise
    const requestPromise = requestFunction().finally(() => {
      // Clean up after request completes
      setTimeout(() => {
        this.pendingRequests.delete(cacheKey);
      }, 1000);
    });

    this.pendingRequests.set(cacheKey, requestPromise);
    return requestPromise;
  }

  clearCache() {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  clearExpiredCache() {
    for (const [key, value] of this.cache.entries()) {
      if (Date.now() - value.timestamp > value.duration) {
        this.cache.delete(key);
      }
    }
  }
}

// Global cache instance
const requestCache = new RequestCache();

// Clean expired cache every 5 minutes
setInterval(() => {
  requestCache.clearExpiredCache();
}, 5 * 60 * 1000);

/** ——————————— AUTH CLIENT ——————————— **/
const authClient = axios.create({
  baseURL: `${BACKEND_URL}/auth`,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** ——————————— EBAY CLIENT ——————————— **/
const apiClient = axios.create({
  baseURL: `${BACKEND_URL}/api/ebay`,
});

const pricingClient = axios.create({
  baseURL: `${BACKEND_URL}/api/pricing-strategies`,
});

const competitorClient = axios.create({
  baseURL: `${BACKEND_URL}/api/competitor-rules`,
});

/** ————————— UTILITY: Get tokens and user ID ————————— **/
function getRawEbayTokenFromStorage() {
  return localStorage.getItem('ebay_user_token');
}

function getAppJwtToken() {
  try {
    // First try to get from Zustand auth-store (new format)
    const authStore = JSON.parse(localStorage.getItem('auth-store') || '{}');
    if (authStore?.state?.user?.token) {
      return authStore.state.user.token;
    }

    // Fallback to old user-store format
    const userStore = JSON.parse(localStorage.getItem('user-store') || '{}');
    if (userStore?.state?.user?.token) {
      return userStore.state.user.token;
    }

    // Fallback to direct localStorage
    return localStorage.getItem('app_jwt') || '';
  } catch (e) {
    console.error('Error getting JWT token:', e);
    return localStorage.getItem('app_jwt') || '';
  }
}

function getUserId() {
  try {
    // First try to get from Zustand auth-store (new format)
    const authStore = JSON.parse(localStorage.getItem('auth-store') || '{}');
    if (authStore?.state?.user?.id) {
      return authStore.state.user.id;
    }

    // Fallback to old user-store format
    const userStore = JSON.parse(localStorage.getItem('user-store') || '{}');
    if (userStore?.state?.user?.id) {
      return userStore.state.user.id;
    }

    // Fallback to direct localStorage
    return localStorage.getItem('user_id') || localStorage.getItem('userId') || '';
  } catch (e) {
    console.error('Error getting user ID:', e);
    return localStorage.getItem('user_id') || localStorage.getItem('userId') || '';
  }
}

// ENHANCED: Request interceptors with authentication and userId
apiClient.interceptors.request.use((config) => {
  const token = getAppJwtToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Also add userId to query params if not present and available
  const userId = getUserId();
  if (userId && !config.params?.userId && !config.url?.includes('userId=')) {
    config.params = { ...config.params, userId };
  }

  console.log('🔑 eBay API Request:', {
    url: config.url,
    hasToken: !!token,
    userId: userId,
    method: config.method
  });

  return config;
});

pricingClient.interceptors.request.use((config) => {
  const token = getAppJwtToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Also add userId to query params if not present and available
  const userId = getUserId();
  if (userId && !config.params?.userId && !config.url?.includes('userId=')) {
    config.params = { ...config.params, userId };
  }

  console.log('💰 Pricing Request:', {
    url: config.url,
    hasToken: !!token,
    userId: userId,
    method: config.method
  });

  return config;
});

competitorClient.interceptors.request.use((config) => {
  const token = getAppJwtToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Also add userId to query params if not present and available
  const userId = getUserId();
  if (userId && !config.params?.userId && !config.url?.includes('userId=')) {
    config.params = { ...config.params, userId };
  }

  return config;
});

/** ————————————— RESPONSE INTERCEPTORS FOR AUTH ERRORS ————————————— **/
function handleAuthError(error) {
  if (error.response?.status === 401) {
    console.warn('⚠️ Authentication failed. Clearing storage and reloading...');

    // Clear all authentication-related data
    localStorage.removeItem('auth-store');
    localStorage.removeItem('user-store');
    localStorage.removeItem('app_jwt');
    localStorage.removeItem('ebay_user_token');
    localStorage.removeItem('ebay_refresh_token');
    localStorage.removeItem('userId');
    localStorage.removeItem('user_id');

    // Clear cache
    requestCache.clearCache();

    // Reload the page to redirect to login
    window.location.reload();
  }
  return Promise.reject(error);
}

// Handle 401 errors for all clients
apiClient.interceptors.response.use((response) => response, handleAuthError);
pricingClient.interceptors.response.use((response) => response, handleAuthError);
competitorClient.interceptors.response.use((response) => response, handleAuthError);

/** ————————————— GLOBAL RESPONSE INTERCEPTOR FOR EBAY ERRORS ————————————— **/
apiClient.interceptors.response.use(
  (response) => {
    // Check for eBay API errors even in successful HTTP responses
    if (
      response.data?.success &&
      response.data?.data?.GetMyeBaySellingResponse?.Ack === 'Failure'
    ) {
      const ebayError = response.data.data.GetMyeBaySellingResponse.Errors;

      if (ebayError?.ErrorCode === '932') {
        console.warn('eBay token hard expired detected in response');
        localStorage.removeItem('ebay_user_token');
        localStorage.removeItem('ebay_refresh_token');

        // Clear cache when token expires
        requestCache.clearCache();

        // Dispatch event to notify components
        window.dispatchEvent(new CustomEvent('ebayTokenExpired'));
      }
    }

    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      // Check if it's an eBay token expiry
      const errorData = error.response.data;
      if (
        errorData?.errors?.[0]?.errorId === 932 ||
        errorData?.data?.GetMyeBaySellingResponse?.Errors?.ErrorCode === '932'
      ) {
        localStorage.removeItem('ebay_user_token');
        localStorage.removeItem('ebay_refresh_token');
        requestCache.clearCache();

        // Dispatch a custom event to notify components
        window.dispatchEvent(new CustomEvent('ebayTokenExpired'));
      } else {
        // General auth failure - clear all and reload
        console.warn('⚠️ Authentication failed. Clearing storage and reloading...');
        localStorage.removeItem('auth-store');
        localStorage.removeItem('user-store');
        localStorage.removeItem('app_jwt');
        localStorage.removeItem('ebay_user_token');
        localStorage.removeItem('ebay_refresh_token');
        localStorage.removeItem('userId');
        localStorage.removeItem('user_id');
        requestCache.clearCache();
        window.location.reload();
      }
    }
    return Promise.reject(error);
  }
);

/** ————————— ENHANCED INVENTORY SERVICE WITH CACHING ————————— **/
const inventory = {
  getActiveListings: async (useCache = true) => {
    const userId = getUserId();
    const cacheKey = requestCache.getCacheKey('active-listings', { userId });
    
    // Check cache first if enabled
    if (useCache && requestCache.isCacheValid(cacheKey)) {
      console.log('📦 Using cached active listings');
      return requestCache.getCacheValue(cacheKey);
    }

    // Use request deduplication to prevent multiple simultaneous calls
    return requestCache.deduplicate(cacheKey, async () => {
      try {
        console.log('🔄 Fetching fresh active listings from API');
        const resp = await apiClient.get('/active-listings', {
          params: { userId },
        });
        
        // Cache successful response for 2 minutes (listings change frequently)
        if (resp.data.success) {
          requestCache.setCacheValue(cacheKey, resp.data, 2 * 60 * 1000);
        }
        
        return resp.data;
      } catch (err) {
        console.error('❌ Error fetching active listings:', err.message);
        return { success: false, error: err.message };
      }
    });
  },

  editPrice: async (requestData) => {
    try {
      const resp = await apiClient.post('/edit-variation-price', requestData);
      
      // Clear cache after price edit
      const userId = getUserId();
      const listingsCacheKey = requestCache.getCacheKey('active-listings', { userId });
      requestCache.cache.delete(listingsCacheKey);
      
      return resp.data;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  triggerAutoSync: async (params = {}) => {
    try {
      const resp = await axios.get(`${BACKEND_URL}/api/sync/scheduled`, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY || '',
        },
        params,
      });
      
      // Clear cache after sync
      requestCache.clearCache();
      
      return resp.data;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  getManuallyAddedCompetitors: async (itemId, useCache = true) => {
    const userId = getUserId();
    const cacheKey = requestCache.getCacheKey('manual-competitors', { itemId, userId });

    if (!userId) {
      return { success: false, error: 'User ID not found' };
    }

    // Check cache first
    if (useCache && requestCache.isCacheValid(cacheKey, requestCache.SHORT_CACHE_DURATION)) {
      console.log(`📦 Using cached competitors for ${itemId}`);
      return requestCache.getCacheValue(cacheKey);
    }

    // Use request deduplication
    return requestCache.deduplicate(cacheKey, async () => {
      try {
        console.log(`🔄 Fetching fresh competitors for ${itemId}`);
        const resp = await competitorClient.get(`/get-manual-competitors/${itemId}`, {
          params: { userId },
        });

        // Cache successful response for 30 seconds
        if (resp.data.success) {
          requestCache.setCacheValue(cacheKey, resp.data, requestCache.SHORT_CACHE_DURATION);
        }

        return resp.data;
      } catch (err) {
        console.error(`❌ Error fetching competitors for ${itemId}:`, err.message);
        return {
          success: false,
          error: err.response?.data?.message || err.message,
          competitors: [],
        };
      }
    });
  },

  searchCompetitorsManually: async (itemId, competitorItemIds) => {
    try {
      const userId = getUserId();

      if (!userId) {
        return { success: false, error: 'User ID not found' };
      }

      const resp = await competitorClient.post(
        `/search-competitors-manually/${itemId}`,
        {
          userId,
          competitorItemIds,
        }
      );

      // Clear competitors cache for this item
      const cacheKey = requestCache.getCacheKey('manual-competitors', { itemId, userId });
      requestCache.cache.delete(cacheKey);

      return resp.data;
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  },

  addCompetitorsManually: async (itemId, competitorItemIds) => {
    try {
      const userId = getUserId();

      if (!userId) {
        return { success: false, error: 'User ID not found' };
      }

      const resp = await competitorClient.post(
        `/add-competitors-manually/${itemId}`,
        {
          userId,
          competitorItemIds,
        }
      );

      // Clear competitors cache for this item
      const cacheKey = requestCache.getCacheKey('manual-competitors', { itemId, userId });
      requestCache.cache.delete(cacheKey);

      return resp.data;
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  },

  removeManualCompetitor: async (itemId, competitorItemId) => {
    try {
      const userId = getUserId();

      if (!userId) {
        return { success: false, error: 'User ID not found' };
      }

      const resp = await competitorClient.delete(
        `/remove-manual-competitor/${itemId}/${competitorItemId}`,
        {
          params: { userId },
        }
      );

      // Clear competitors cache for this item
      const cacheKey = requestCache.getCacheKey('manual-competitors', { itemId, userId });
      requestCache.cache.delete(cacheKey);

      return resp.data;
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  },

  updateListingPricing: async (itemId, { minPrice, maxPrice }) => {
    const token = getAppJwtToken();
    const response = await fetch(
      `${BACKEND_URL}/api/inventory/pricing/${itemId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ minPrice, maxPrice }),
      }
    );

    // Clear relevant caches after pricing update
    const userId = getUserId();
    const listingsCacheKey = requestCache.getCacheKey('active-listings', { userId });
    const strategyCacheKey = requestCache.getCacheKey('strategy-display', { itemId });
    requestCache.cache.delete(listingsCacheKey);
    requestCache.cache.delete(strategyCacheKey);

    return response.json();
  },
};

/** ————————————— AUTH (LOGIN / REGISTER / EXCHANGE CODE / GET TOKEN) ————————————— **/
const auth = {
  register: async (credentials) => {
    try {
      const resp = await authClient.post('/register', credentials);
      return resp.data;
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  },
  login: async (credentials) => {
    try {
      const resp = await authClient.post('/login', credentials);
      // Clear cache on login
      requestCache.clearCache();
      return resp.data;
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  },
  exchangeCode: async ({ code, userId }) => {
    try {
      const resp = await authClient.post('/exchange-code', { code, userId });
      // Clear cache after token exchange
      requestCache.clearCache();
      return resp.data;
    } catch (err) {
      console.error('📡 Exchange-code error:', err.response?.data || err.message);
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  },
  getEbayUserToken: async (userId) => {
    try {
      const resp = await authClient.get('/token', { params: { userId } });
      return resp.data;
    } catch (err) {
      console.error('📡 Get token error:', err.response?.data || err.message);
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  },
  refreshEbayUserToken: async (userId) => {
    try {
      const resp = await authClient.get('/refresh', { params: { userId } });
      // Clear cache after token refresh
      requestCache.clearCache();
      return resp.data;
    } catch (err) {
      console.error('📡 Refresh token error:', err.response?.data || err.message);
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  },
  ebayLogout: async (userId) => {
    try {
      const resp = await authClient.post('/ebay-logout', { userId });
      // Clear cache on logout
      requestCache.clearCache();
      return resp.data;
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.message || err.message,
      };
    }
  },
};

/** ————————————— ENHANCED PRICING STRATEGIES WITH CACHING ————————————— **/
const pricingStrategies = {
  createStrategy: async (strategyData) => {
    try {
      const resp = await pricingClient.post('/', strategyData);
      
      // Clear strategies cache after creation
      const userId = getUserId();
      const strategiesCacheKey = requestCache.getCacheKey('unique-strategies', { userId });
      requestCache.cache.delete(strategiesCacheKey);
      
      return resp.data;
    } catch (err) {
      if (err.response?.status === 401) {
        throw new Error('Authentication failed. Please log in again.');
      }
      throw err;
    }
  },

  createStrategyOnProduct: async (itemId, strategyData) => {
    try {
      // First create the strategy
      const strategyResp = await pricingClient.post('/', strategyData);
      if (!strategyResp.data.success) {
        throw new Error(strategyResp.data.message || 'Failed to create strategy');
      }

      const strategyId = strategyResp.data.data._id;

      // Then apply it to the product
      const applyResp = await pricingClient.post(`/products/${itemId}/apply`, {
        strategyId: strategyId,
      });

      // Clear relevant caches
      const userId = getUserId();
      const strategiesCacheKey = requestCache.getCacheKey('unique-strategies', { userId });
      const strategyCacheKey = requestCache.getCacheKey('strategy-display', { itemId });
      const listingsCacheKey = requestCache.getCacheKey('active-listings', { userId });
      
      requestCache.cache.delete(strategiesCacheKey);
      requestCache.cache.delete(strategyCacheKey);
      requestCache.cache.delete(listingsCacheKey);

      return {
        success: true,
        strategy: strategyResp.data.data,
        application: applyResp.data,
      };
    } catch (err) {
      if (err.response?.status === 401) {
        throw new Error('Authentication failed. Please log in again.');
      }
      throw err;
    }
  },

  applyStrategyToProduct: async (itemId, strategyData) => {
    try {
      const userId = getUserId();

      let response;
      // Handle both array and single strategy formats
      if (Array.isArray(strategyData) && strategyData.length === 1) {
        const item = strategyData[0];
        response = await pricingClient.post(`/products/${itemId}/apply`, {
          strategyId: item.strategyId || item._id,
          sku: item.sku,
          title: item.title,
          minPrice: item.minPrice,
          maxPrice: item.maxPrice,
          userId,
        });
      } else if (!Array.isArray(strategyData)) {
        // Handle single object format
        response = await pricingClient.post(`/products/${itemId}/apply`, {
          strategyId: strategyData.strategyId || strategyData._id,
          sku: strategyData.sku,
          title: strategyData.title,
          minPrice: strategyData.minPrice,
          maxPrice: strategyData.maxPrice,
          userId,
        });
      } else {
        // Handle multiple items or old format
        response = await pricingClient.post('/apply', {
          items: strategyData,
        });
      }

      // Clear relevant caches after applying strategy
      const strategyCacheKey = requestCache.getCacheKey('strategy-display', { itemId });
      const listingsCacheKey = requestCache.getCacheKey('active-listings', { userId });
      requestCache.cache.delete(strategyCacheKey);
      requestCache.cache.delete(listingsCacheKey);

      return response.data;
    } catch (error) {
      console.error('Error applying strategy to product:', error);
      throw error;
    }
  },

  getStrategyFromProduct: async (itemId, useCache = true) => {
    const cacheKey = requestCache.getCacheKey('strategy-from-product', { itemId });
    
    // Check cache first
    if (useCache && requestCache.isCacheValid(cacheKey, requestCache.SHORT_CACHE_DURATION)) {
      console.log(`📦 Using cached strategy for product ${itemId}`);
      return requestCache.getCacheValue(cacheKey);
    }

    try {
      const resp = await pricingClient.get(`/products/${itemId}`);
      
      // Cache successful response for 30 seconds
      if (resp.data.success) {
        requestCache.setCacheValue(cacheKey, resp.data, requestCache.SHORT_CACHE_DURATION);
      }
      
      return resp.data;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  getAllActiveWithStrategies: async (useCache = true) => {
    const userId = getUserId();
    const cacheKey = requestCache.getCacheKey('active-with-strategies', { userId });
    
    // Check cache first
    if (useCache && requestCache.isCacheValid(cacheKey)) {
      console.log('📦 Using cached active listings with strategies');
      return requestCache.getCacheValue(cacheKey);
    }

    try {
      const resp = await pricingClient.get(`/active-listings`, {
        params: { userId },
      });
      
      // Cache successful response for 2 minutes
      if (resp.data.success) {
        requestCache.setCacheValue(cacheKey, resp.data, 2 * 60 * 1000);
      }
      
      return resp.data;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  updateStrategyOnProduct: async (itemId, { strategyId, minPrice, maxPrice }) => {
    try {
      const resp = await pricingClient.put(`/products/${itemId}/strategy`, {
        strategyId,
        minPrice,
        maxPrice,
      });

      // Clear relevant caches after update
      const userId = getUserId();
      const strategyCacheKey = requestCache.getCacheKey('strategy-display', { itemId });
      const strategyFromProductCacheKey = requestCache.getCacheKey('strategy-from-product', { itemId });
      const listingsCacheKey = requestCache.getCacheKey('active-listings', { userId });
      
      requestCache.cache.delete(strategyCacheKey);
      requestCache.cache.delete(strategyFromProductCacheKey);
      requestCache.cache.delete(listingsCacheKey);

      return resp.data;
    } catch (err) {
      console.error('Error updating strategy on product:', err);
      throw err;
    }
  },

  deleteStrategyFromProduct: async (itemId) => {
    try {
      const resp = await pricingClient.delete(`/products/${itemId}`);

      // Clear relevant caches after deletion
      const userId = getUserId();
      const strategyCacheKey = requestCache.getCacheKey('strategy-display', { itemId });
      const strategyFromProductCacheKey = requestCache.getCacheKey('strategy-from-product', { itemId });
      const listingsCacheKey = requestCache.getCacheKey('active-listings', { userId });
      const strategiesCacheKey = requestCache.getCacheKey('unique-strategies', { userId });
      
      requestCache.cache.delete(strategyCacheKey);
      requestCache.cache.delete(strategyFromProductCacheKey);
      requestCache.cache.delete(listingsCacheKey);
      requestCache.cache.delete(strategiesCacheKey);

      return resp.data;
    } catch (err) {
      throw err;
    }
  },

  deleteStrategiesFromAllActive: async () => {
    try {
      const resp = await pricingClient.delete(`/delete-from-all-active`);
      
      // Clear all strategy-related caches
      requestCache.clearCache();
      
      return resp.data;
    } catch (err) {
      throw err;
    }
  },

  applyStrategyBulk: async (applyData) => {
    try {
      const resp = await pricingClient.post(`/apply-bulk`, applyData);
      
      // Clear all strategy-related caches
      requestCache.clearCache();
      
      return resp.data;
    } catch (err) {
      throw err;
    }
  },

  getAllUniqueStrategies: async (useCache = true) => {
    const userId = getUserId();
    const cacheKey = requestCache.getCacheKey('unique-strategies', { userId });
    
    // Check cache first
    if (useCache && requestCache.isCacheValid(cacheKey)) {
      console.log('📦 Using cached unique strategies');
      return requestCache.getCacheValue(cacheKey);
    }

    try {
      const resp = await pricingClient.get(`/active-listings`, {
        params: { userId, active: true },
      });

      const result = {
        success: resp.data.success,
        strategies: resp.data.strategies || [],
        count: resp.data.count || 0,
      };

      // Cache successful response for 2 minutes
      if (result.success) {
        requestCache.setCacheValue(cacheKey, result, 2 * 60 * 1000);
      }

      return result;
    } catch (err) {
      return { success: false, error: err.message, strategies: [] };
    }
  },

  getStrategyDisplayForProduct: async (itemId, sku = null, useCache = true) => {
    const cacheKey = requestCache.getCacheKey('strategy-display', { itemId, sku });
    
    // Check cache first (short cache duration for frequently changing data)
    if (useCache && requestCache.isCacheValid(cacheKey, requestCache.SHORT_CACHE_DURATION)) {
      console.log(`📦 Using cached strategy display for ${itemId}`);
      return requestCache.getCacheValue(cacheKey);
    }

    // Use request deduplication to prevent multiple simultaneous calls
    return requestCache.deduplicate(cacheKey, async () => {
      try {
        console.log(`🔄 Fetching fresh strategy display for ${itemId}`);
        const queryParams = sku ? `?sku=${encodeURIComponent(sku)}` : '';
        const response = await pricingClient.get(`/products/${itemId}/display${queryParams}`);
        
        // Cache successful response for 30 seconds
        if (response.data.success) {
          requestCache.setCacheValue(cacheKey, response.data, requestCache.SHORT_CACHE_DURATION);
        }
        
        return response.data;
      } catch (error) {
        console.error('Error getting strategy display:', error);
        throw error;
      }
    });
  },

  updatePrice: async (itemId, strategyId) => {
    try {
      const response = await pricingClient.post(
        `/products/${itemId}/execute`,
        null,
        { params: { strategyId } }
      );

      // Clear relevant caches after price update
      const userId = getUserId();
      const strategyCacheKey = requestCache.getCacheKey('strategy-display', { itemId });
      const listingsCacheKey = requestCache.getCacheKey('active-listings', { userId });
      
      requestCache.cache.delete(strategyCacheKey);
      requestCache.cache.delete(listingsCacheKey);

      return response.data;
    } catch (error) {
      console.error('Error updating price:', error);
      throw error;
    }
  },
};

/** ————————————— ENHANCED COMPETITOR RULES WITH CACHING ————————————— **/
const competitorRules = {
  createRuleOnProduct: async (itemId, ruleData) => {
    const userId = getUserId();
    const payload = { ...ruleData, userId };
    const resp = await competitorClient.post(`/products/${itemId}`, payload);
    
    // Clear relevant caches
    const rulesCacheKey = requestCache.getCacheKey('unique-rules', { userId });
    const allRulesCacheKey = requestCache.getCacheKey('all-rules', { userId });
    requestCache.cache.delete(rulesCacheKey);
    requestCache.cache.delete(allRulesCacheKey);
    
    return resp.data;
  },

  createRuleForAllActive: async (ruleData) => {
    try {
      const resp = await competitorClient.post(`/assign-to-all-active`, ruleData);
      
      // Clear all rule-related caches
      requestCache.clearCache();
      
      return resp.data;
    } catch (err) {
      throw err;
    }
  },

  getRuleFromProduct: async (itemId, useCache = true) => {
    const userId = getUserId();
    const cacheKey = requestCache.getCacheKey('rule-from-product', { itemId, userId });
    
    // Check cache first
    if (useCache && requestCache.isCacheValid(cacheKey, requestCache.SHORT_CACHE_DURATION)) {
      console.log(`📦 Using cached rule for product ${itemId}`);
      return requestCache.getCacheValue(cacheKey);
    }

    try {
      const resp = await competitorClient.get(`/products/${itemId}`, {
        params: { userId },
      });
      
      // Cache successful response for 30 seconds
      if (resp.data.success) {
        requestCache.setCacheValue(cacheKey, resp.data, requestCache.SHORT_CACHE_DURATION);
      }
      
      return resp.data;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  getAllActiveWithRules: async (useCache = true) => {
    const userId = getUserId();
    const cacheKey = requestCache.getCacheKey('active-with-rules', { userId });
    
    // Check cache first
    if (useCache && requestCache.isCacheValid(cacheKey)) {
      console.log('📦 Using cached active listings with rules');
      return requestCache.getCacheValue(cacheKey);
    }

    try {
      const resp = await competitorClient.get(`/active-listings`, {
        params: { userId },
      });
      
      // Cache successful response for 2 minutes
      if (resp.data.success) {
        requestCache.setCacheValue(cacheKey, resp.data, 2 * 60 * 1000);
      }
      
      return resp.data;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  updateRuleOnProduct: async (itemId, ruleData) => {
    try {
      const resp = await competitorClient.put(`/products/${itemId}`, ruleData);
      
      // Clear relevant caches
      const userId = getUserId();
      const ruleCacheKey = requestCache.getCacheKey('rule-from-product', { itemId, userId });
      const rulesCacheKey = requestCache.getCacheKey('unique-rules', { userId });
      const allRulesCacheKey = requestCache.getCacheKey('all-rules', { userId });
      
      requestCache.cache.delete(ruleCacheKey);
      requestCache.cache.delete(rulesCacheKey);
      requestCache.cache.delete(allRulesCacheKey);
      
      return resp.data;
    } catch (err) {
      throw err;
    }
  },

  deleteRuleFromProduct: async (itemId) => {
    try {
      const resp = await competitorClient.delete(`/products/${itemId}`);
      
      // Clear relevant caches
      const userId = getUserId();
      const ruleCacheKey = requestCache.getCacheKey('rule-from-product', { itemId, userId });
      const rulesCacheKey = requestCache.getCacheKey('unique-rules', { userId });
      const allRulesCacheKey = requestCache.getCacheKey('all-rules', { userId });
      
      requestCache.cache.delete(ruleCacheKey);
      requestCache.cache.delete(rulesCacheKey);
      requestCache.cache.delete(allRulesCacheKey);
      
      return resp.data;
    } catch (err) {
      throw err;
    }
  },

  deleteRulesFromAllActive: async () => {
    try {
      const resp = await competitorClient.delete(`/delete-from-all-active`);
      
      // Clear all rule-related caches
      requestCache.clearCache();
      
      return resp.data;
    } catch (err) {
      throw err;
    }
  },

  getAllUniqueRules: async (useCache = true) => {
    const userId = getUserId();
    const cacheKey = requestCache.getCacheKey('unique-rules', { userId });
    
    // Check cache first
    if (useCache && requestCache.isCacheValid(cacheKey)) {
      console.log('📦 Using cached unique rules');
      return requestCache.getCacheValue(cacheKey);
    }

    try {
      const resp = await competitorClient.get(`/active-listings`, {
        params: { userId },
      });

      // Extract unique rules from listings
      const rulesFromListings = (resp.data.listings || [])
        .map((l) => l.competitorRule)
        .filter((r) => r !== null && typeof r === 'object');

      const ruleMap = new Map();
      rulesFromListings.forEach((rule) => {
        ruleMap.set(rule._id, rule);
      });

      const result = {
        success: true,
        rules: Array.from(ruleMap.values()), // deduplicated
      };

      // Cache successful response for 2 minutes
      requestCache.setCacheValue(cacheKey, result, 2 * 60 * 1000);

      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  getAllRules: async (useCache = true) => {
    const userId = getUserId();
    const cacheKey = requestCache.getCacheKey('all-rules', { userId });
    
    // Check cache first
    if (useCache && requestCache.isCacheValid(cacheKey)) {
      console.log('📦 Using cached all rules');
      return requestCache.getCacheValue(cacheKey);
    }

    try {
      const resp = await competitorClient.get(`/`, {
        params: { active: true, userId },
      });

      // Handle both possible response structures
      const rules = resp.data?.data || resp.data?.rules || resp.data || [];

      const result = {
        success: true,
        rules: Array.isArray(rules) ? rules : [],
      };

      // Cache successful response for 2 minutes
      requestCache.setCacheValue(cacheKey, result, 2 * 60 * 1000);

      return result;
    } catch (err) {
      if (err.response?.status === 404) {
        const result = { success: true, rules: [] };
        requestCache.setCacheValue(cacheKey, result, 2 * 60 * 1000);
        return result;
      }
      return { success: false, error: err.message };
    }
  },
};

/** —————————————— COMBINED HELPERS —————————————— **/
const combined = {
  getProductRulesAndStrategies: async (itemId, useCache = true) => {
    try {
      const [stratRes, ruleRes] = await Promise.allSettled([
        pricingStrategies.getStrategyFromProduct(itemId, useCache),
        competitorRules.getRuleFromProduct(itemId, useCache),
      ]);
      return {
        success: true,
        strategy: stratRes.status === 'fulfilled' ? stratRes.value : null,
        rule: ruleRes.status === 'fulfilled' ? ruleRes.value : null,
        errors: {
          strategy:
            stratRes.status === 'rejected' ? stratRes.reason.message : null,
          rule: ruleRes.status === 'rejected' ? ruleRes.reason.message : null,
        },
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  getAllOptionsForDropdowns: async (useCache = true) => {
    try {
      const [strategiesRes, rulesRes] = await Promise.allSettled([
        pricingStrategies.getAllUniqueStrategies(useCache),
        competitorRules.getAllRules(useCache),
      ]);
      const allOptions = {
        success: true,
        strategies:
          strategiesRes.status === 'fulfilled'
            ? strategiesRes.value.strategies || []
            : [],
        rules:
          rulesRes.status === 'fulfilled' ? rulesRes.value.rules || [] : [],
        errors: {
          strategies:
            strategiesRes.status === 'rejected'
              ? strategiesRes.reason.message
              : null,
          rules:
            rulesRes.status === 'rejected' ? rulesRes.reason.message : null,
        },
      };
      return allOptions;
    } catch (err) {
      return { success: false, error: err.message, strategies: [], rules: [] };
    }
  },

  createRuleAndStrategy: async (
    itemId,
    ruleData,
    strategyData,
    assignToAll = false
  ) => {
    try {
      const promises = [];
      if (ruleData) {
        if (assignToAll) {
          promises.push(competitorRules.createRuleForAllActive(ruleData));
        } else {
          promises.push(competitorRules.createRuleOnProduct(itemId, ruleData));
        }
      }
      if (strategyData) {
        if (assignToAll) {
          promises.push(
            pricingStrategies.createStrategyForAllActive(strategyData)
          );
        } else {
          promises.push(
            pricingStrategies.createStrategyOnProduct(itemId, strategyData)
          );
        }
      }
      const results = await Promise.allSettled(promises);
      
      // Clear relevant caches after creation
      requestCache.clearCache();
      
      return {
        success: true,
        results: results.map((r) =>
          r.status === 'fulfilled' ? r.value : { error: r.reason.message }
        ),
      };
    } catch (err) {
      throw err;
    }
  },
};

const BASE_URL = import.meta.env.VITE_API_URL;

// Helper function to create authenticated requests
const createAuthenticatedRequest = async () => {
  const token = getAppJwtToken();
  if (!token) {
    throw new Error('No authentication token found');
  }

  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
};

// Price History endpoints (with basic caching)
const priceHistory = {
  getProductHistory: async (itemId, limit = 100, useCache = true) => {
    const cacheKey = requestCache.getCacheKey('price-history', { itemId, limit });
    
    if (useCache && requestCache.isCacheValid(cacheKey, requestCache.SHORT_CACHE_DURATION)) {
      console.log(`📦 Using cached price history for ${itemId}`);
      return requestCache.getCacheValue(cacheKey);
    }

    try {
      const { headers } = await createAuthenticatedRequest();

      const response = await fetch(
        `${BACKEND_URL}/api/price-history/product/${itemId}?limit=${limit}`,
        {
          method: 'GET',
          headers,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Cache successful response for 30 seconds
      if (data.success) {
        requestCache.setCacheValue(cacheKey, data, requestCache.SHORT_CACHE_DURATION);
      }
      
      return data;
    } catch (error) {
      throw error;
    }
  },

  getProductSummary: async (itemId, useCache = true) => {
    const cacheKey = requestCache.getCacheKey('price-summary', { itemId });
    
    if (useCache && requestCache.isCacheValid(cacheKey, requestCache.SHORT_CACHE_DURATION)) {
      console.log(`📦 Using cached price summary for ${itemId}`);
      return requestCache.getCacheValue(cacheKey);
    }

    try {
      const { headers } = await createAuthenticatedRequest();

      const response = await fetch(
        `${BACKEND_URL}/api/price-history/summary/${itemId}`,
        {
          method: 'GET',
          headers,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Cache successful response for 30 seconds
      if (data.success) {
        requestCache.setCacheValue(cacheKey, data, requestCache.SHORT_CACHE_DURATION);
      }
      
      return data;
    } catch (error) {
      return {
        success: false,
        summary: {
          hasHistory: false,
          totalChanges: 0,
          latestChange: null,
          currentPrice: null,
          priceDirection: 'unchanged',
        },
      };
    }
  },

  getPaginatedHistory: async (itemId, options = {}) => {
    try {
      const { headers } = await createAuthenticatedRequest();

      const {
        sku = null,
        limit = 100,
        page = 1,
        sortBy = 'createdAt',
        sortOrder = -1,
      } = options;

      const queryParams = new URLSearchParams({
        limit: limit.toString(),
        page: page.toString(),
        sortBy,
        sortOrder: sortOrder.toString(),
      });

      if (sku) queryParams.append('sku', sku);

      const response = await fetch(
        `${BASE_URL}/price-history/product/${itemId}/paginated?${queryParams}`,
        {
          method: 'GET',
          headers,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      throw error;
    }
  },

  addManualRecord: async (recordData) => {
    try {
      const { headers } = await createAuthenticatedRequest();

      const response = await fetch(`${BASE_URL}/price-history/history/manual`, {
        method: 'POST',
        headers,
        body: JSON.stringify(recordData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || `HTTP error! status: ${response.status}`
        );
      }

      const data = await response.json();
      
      // Clear price history cache after adding record
      const itemId = recordData.itemId;
      if (itemId) {
        const historyCacheKey = requestCache.getCacheKey('price-history', { itemId });
        const summaryCacheKey = requestCache.getCacheKey('price-summary', { itemId });
        requestCache.cache.delete(historyCacheKey);
        requestCache.cache.delete(summaryCacheKey);
      }
      
      return data;
    } catch (error) {
      throw error;
    }
  },

  getAnalytics: async (itemId, options = {}) => {
    try {
      const { headers } = await createAuthenticatedRequest();

      const { sku = null, period = '30d' } = options;

      const queryParams = new URLSearchParams({ period });
      if (sku) queryParams.append('sku', sku);

      const response = await fetch(
        `${BASE_URL}/price-history/analytics/${itemId}?${queryParams}`,
        {
          method: 'GET',
          headers,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      throw error;
    }
  },

  exportHistory: async (itemId, options = {}) => {
    try {
      const { headers } = await createAuthenticatedRequest();

      const { sku = null, format = 'json' } = options;

      const queryParams = new URLSearchParams({ format });
      if (sku) queryParams.append('sku', sku);

      const response = await fetch(
        `${BASE_URL}/price-history/export/${itemId}?${queryParams}`,
        {
          method: 'GET',
          headers,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (format === 'csv') {
        const csvData = await response.text();
        return { success: true, data: csvData, format: 'csv' };
      } else {
        const data = await response.json();
        return data;
      }
    } catch (error) {
      throw error;
    }
  },

  bulkInsert: async (records) => {
    try {
      const { headers } = await createAuthenticatedRequest();

      const response = await fetch(`${BASE_URL}/price-history/bulk`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || `HTTP error! status: ${response.status}`
        );
      }

      const data = await response.json();
      
      // Clear all price history cache after bulk insert
      requestCache.clearCache();
      
      return data;
    } catch (error) {
      throw error;
    }
  },

  archiveOldRecords: async (keepRecentCount = 1000) => {
    try {
      const { headers } = await createAuthenticatedRequest();

      const response = await fetch(`${BASE_URL}/price-history/archive`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ keepRecentCount }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || `HTTP error! status: ${response.status}`
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      throw error;
    }
  },
};

// Helper functions for competitor rules
export async function createCompetitorRule(itemId, ruleData) {
  const userId = getUserId();
  return axios.post(`/api/competitor-rules/products/${itemId}`, {
    ...ruleData,
    userId,
  });
}

export async function updateCompetitorRule(itemId, ruleData) {
  const userId = getUserId();
  return axios.put(`/api/competitor-rules/products/${itemId}`, {
    ...ruleData,
    userId,
  });
}

export async function deleteCompetitorRule(itemId) {
  const userId = getUserId();
  return axios.delete(`/api/competitor-rules/products/${itemId}`, {
    data: { userId },
  });
}

// Export the cache instance for manual cache management if needed
export { requestCache };

export default {
  inventory,
  auth,
  pricingStrategies,
  competitorRules,
  combined,
  priceHistory,
  createCompetitorRule: async (itemId, ruleData) => {
    return axios.post(`/api/competitor-rules/products/${itemId}`, {
      ...ruleData,
      userId: getUserId(),
    });
  },
};