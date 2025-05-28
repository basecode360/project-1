import express from "express";
import xml2js from "xml2js";
import axios from "axios";
import Bottleneck from "bottleneck";

// Initialize Express app
const route = express.Router();

// Middleware
const limiter = new Bottleneck({
  minTime: 333, // Min 333ms between requests (3/second max)
  maxConcurrent: 1 // Only 1 request at a time
});

// Wrap your API functions
const throttledFetchCompetitorPrices = limiter.wrap(fetchCompetitorPrices);


/**
 * Fetch competitor prices from eBay (or simulation)
 * @param {string} itemId - The eBay item ID
 * @param {string} [apiKey] - Optional API key for eBay API
 * @returns {Promise<Array<number>>} - Array of competitor prices
 */

// async function fetchCompetitorPrices(itemId, apiKey = null) {
//   try {
//     // OPTION 1: Real eBay API call (uncomment and modify when ready to use real API)
//     const response = await axios.get('https://api.ebay.com/market-data/competitor-prices', {
//       params: {
//         itemId,
//         apiKey
//       },
//       headers: {
//         'Authorization': `Bearer ${apiKey}`,
//         'Content-Type': 'routelication/json'
//       }
//     });

//     return response.data.competitorPrices;

//     // OPTION 2: Simulation for testing
//     // Simulate network delay (200-500ms)
//     await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));

//     // Generate 3-7 competitor prices
//     const competitorCount = Math.floor(Math.random() * 5) + 3;

//     // Use the itemId to seed the random generator for consistent prices
//     const seed = parseInt(itemId.toString().replace(/\D/g, '').slice(0, 8) || '12345', 10);
//     const basePrice = (seed % 100) + 10; // Generate a base price between 10 and 109

//     const competitorPrices = [];
//     for (let i = 0; i < competitorCount; i++) {
//       // Generate prices within ±30% of the base price
//       const variance = 0.7 + (((seed * (i + 1)) % 60) / 100);
//       competitorPrices.push(+(basePrice * variance).toFixed(2));
//     }

//     console.log(`Fetched ${competitorPrices.length} competitor prices for item ${itemId}:`, competitorPrices);
//     return competitorPrices;

//   } catch (error) {
//     console.error('Error fetching competitor prices:', error);
//     throw new Error('Failed to fetch competitor prices');
//   }
// }

// async function fetchCompetitorPrices(itemId, apiKey = null) {
//   try {
//     // Real eBay API call
//     const response = await axios.get('https://api.ebay.com/market-data/competitor-prices', {
//       params: {
//         itemId
//       },
//       headers: {
//         'Authorization': `Bearer ${apiKey}`,
//         'Content-Type': 'application/json'
//       }
//     });
//     return response.data.competitorPrices;
//   } catch (error) {
//     console.error(`Error fetching prices for item ${itemId}:`, error);
//     throw error; // Re-throw to handle in the route
//   }
// }

/**
 * Fetch competitor prices using eBay's Finding API
 * @param {string} itemId - The eBay item ID 
 * @param {string} appId - eBay App ID for Finding API
 * @param {string} title - Item title (already fetched)
 * @param {string} categoryId - Item category ID (already fetched)
 * @returns {Promise<Array<number>>} - Array of competitor prices
 */

async function fetchCompetitorPrices(itemId, appId, title, categoryId) {
  // Track retry attempts
  let attempts = 0;
  const maxAttempts = 3;
  
  // Implement exponential backoff
  const backoff = (attempt) => Math.pow(2, attempt) * 1000; // 1s, 2s, 4s...
  
  // Try to get from cache first
  const cacheKey = `${itemId}_prices`;
  const cachedData = await getCachedData(cacheKey);
  if (cachedData) {
    console.log(`Using cached prices for item ${itemId}`);
    return cachedData;
  }
  
  async function attemptFetch() {
    try {
      console.log(`Attempt ${attempts + 1}/${maxAttempts + 1} to fetch competitor prices for ${itemId}`);
      
      // Use the Finding API to find similar items
      const xmlRequestBody = `
        <?xml version="1.0" encoding="utf-8"?>
        <findItemsAdvancedRequest xmlns="http://www.ebay.com/marketplace/search/v1/services">
          <keywords>${title}</keywords>
          ${categoryId ? `<categoryId>${categoryId}</categoryId>` : ""}
          <itemFilter>
            <name>ListingType</name>
            <value>FixedPrice</value>
          </itemFilter>
          <sortOrder>PricePlusShippingLowest</sortOrder>
          <paginationInput>
            <entriesPerPage>10</entriesPerPage>
          </paginationInput>
        </findItemsAdvancedRequest>
      `;

      const response = await axios({
        method: "post",
        url: "https://svcs.ebay.com/services/search/FindingService/v1",
        headers: {
          "Content-Type": "text/xml",
          "X-EBAY-SOA-SECURITY-APPNAME": appId,
          "X-EBAY-SOA-OPERATION-NAME": "findItemsAdvanced",
          "X-EBAY-SOA-SERVICE-VERSION": "1.13.0",
          "X-EBAY-SOA-GLOBAL-ID": "EBAY-US",
        },
        data: xmlRequestBody,
        timeout: 10000, // 10 seconds timeout
      });

      // Parse the XML response
      const parser = new xml2js.Parser({
        explicitArray: false,
        tagNameProcessors: [xml2js.processors.stripPrefix],
      });

      const result = await parser.parseStringPromise(response.data);
      
      // Check for API errors in the response
      if (result.findItemsAdvancedResponse.ack !== "Success") {
        const error = result.findItemsAdvancedResponse.errorMessage?.error;
        if (error) {
          throw new Error(`eBay API Error: ${error.message}`);
        }
      }

      // Extract competitor prices
      const searchResult = result.findItemsAdvancedResponse.searchResult;

      if (searchResult.count === "0") {
        console.log(`No similar items found for item ${itemId}`);
        return [];
      }

      // Handle items (convert to array if needed)
      const items = Array.isArray(searchResult.item)
        ? searchResult.item
        : [searchResult.item];

      // Extract prices and filter out our own item
      const competitorPrices = items
        .filter((item) => item.itemId !== itemId) // Exclude our own item
        .map((item) => {
          const price = parseFloat(
            item.sellingStatus?.currentPrice?.__value__ ||
              item.sellingStatus?.currentPrice?.value
          );
          const shippingCost = parseFloat(
            item.shippingInfo?.shippingServiceCost?.__value__ ||
              item.shippingInfo?.shippingServiceCost?.value ||
              0
          );
          return +(price + shippingCost).toFixed(2);
        })
        .filter((price) => !isNaN(price) && price > 0);

      console.log(`Found ${competitorPrices.length} competitor prices for item ${itemId}`);
      
      // Cache the results for future use (1 hour)
    setCachedData(cacheKey, competitorPrices, 24 * 60 * 60); 
      
      return competitorPrices;

    } catch (error) {
      // Handle rate limiting errors specifically
      if (
        error.response && 
        error.response.status === 500 &&
        error.response.data && 
        error.response.data.includes("RateLimiter")
      ) {
        // If we haven't exceeded max attempts, wait and retry
        if (attempts < maxAttempts) {
          attempts++;
          const waitTime = backoff(attempts);
          console.log(`Rate limit hit. Retrying in ${waitTime/1000} seconds (attempt ${attempts}/${maxAttempts})...`);
          
          // Wait using setTimeout wrapped in a promise
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          // Try again recursively
          return attemptFetch();
        } else {
          // If we've exhausted our retries, use fallback strategy
          console.error(`Rate limit exceeded after ${maxAttempts} attempts. Using fallback.`);
          
          // Option 1: Return empty array as fallback
          console.error(`Rate limit exceeded after ${maxAttempts} attempts. Using mock data.`);
const mockPrices = generateMockCompetitorPrices(itemId);
setCachedData(cacheKey, mockPrices, 24 * 60 * 60, true); // Set isMock flag to true
return mockPrices;
        }
      }
      
      // For other errors, just propagate them
      throw error;
    }
  }
  
  // Start the first attempt
  return attemptFetch();
}

// Simple in-memory cache
const cache = {};

function getCachedData(key) {
  if (cache[key] && cache[key].expires > Date.now()) {
    return cache[key].data;
  }
  return null;
}

function setCachedData(key, data, ttlSeconds = 3600, isMock = false) {
  cache[key] = {
    data,
    expires: Date.now() + (ttlSeconds * 1000),
    isMock
  };
}

// Optional: Generate mock data for testing when rate limited
// Make sure this function is present and not commented out
function generateMockCompetitorPrices(itemId) {
  console.log(`Generating mock data for item ${itemId} due to rate limits`);
  
  // Use itemId as seed for consistent mock data
  const seed = parseInt(itemId.slice(-6), 10);
  const basePrice = (seed % 100) + 20; // between $20 and $119
  
  const count = 3 + (seed % 5); // 3-7 competitor prices
  const prices = [];
  
  for (let i = 0; i < count; i++) {
    // Vary prices within ±15% of base price
    const variation = 0.85 + ((seed * (i+1) % 30) / 100);
    prices.push(+(basePrice * variation).toFixed(2));
  }
  
  return prices;
}

/**
 * Get detailed information about an eBay item using the Trading API
 * @param {string} itemId - eBay item ID
 * @param {string} authToken - eBay OAuth token for Trading API
 * @returns {Promise<Object>} - Item details including title, category, price, etc.
 */
async function getItemDetails(itemId, authToken) {
  if (!itemId) {
    throw new Error("Item ID is required");
  }

  if (!authToken) {
    throw new Error("Auth token is required for accessing eBay Trading API");
  }

  try {
    // Create XML request body for GetItem call
    const xmlRequestBody = `
      <?xml version="1.0" encoding="utf-8"?>
      <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <ItemID>${itemId}</ItemID>
        <DetailLevel>ReturnAll</DetailLevel>
        <IncludeItemSpecifics>true</IncludeItemSpecifics>
      </GetItemRequest>
    `;

    // Make API call to eBay Trading API
    const response = await axios({
      method: "post",
      url: "https://api.ebay.com/ws/api.dll",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1155", // Use latest version
        "X-EBAY-API-CALL-NAME": "GetItem",
        "X-EBAY-API-SITEID": "0", // US site (0)
      },
      data: xmlRequestBody,
    });

    // Parse XML response
    const parser = new xml2js.Parser({
      explicitArray: false,
      tagNameProcessors: [xml2js.processors.stripPrefix],
    });

    const result = await parser.parseStringPromise(response.data);

    // Check for API errors
    if (
      result.GetItemResponse.Ack !== "Success" &&
      result.GetItemResponse.Ack !== "Warning"
    ) {
      const errors = result.GetItemResponse.Errors;
      const errorMsg = Array.isArray(errors)
        ? errors.map((e) => e.LongMessage || e.ShortMessage).join(", ")
        : errors?.LongMessage || errors?.ShortMessage || "Unknown error";

      throw new Error(`eBay API Error: ${errorMsg}`);
    }

    const item = result.GetItemResponse.Item;

    if (!item) {
      throw new Error(`Item ${itemId} not found`);
    }

    // Extract relevant item details
    const itemDetails = {
      itemId: item.ItemID,
      title: item.Title,
      subtitle: item.SubTitle,
      description: item.Description,

      // Category information
      category: {
        id: item.PrimaryCategory?.CategoryID,
        name: item.PrimaryCategory?.CategoryName,
      },

      // Price information
      price: {
        value: parseFloat(
          item.StartPrice?.__value__ || item.StartPrice?.Value || 0
        ),
        currency: item.StartPrice?.__attributes?.currencyID || item.Currency,
      },

      // Listing information
      listingType: item.ListingType,
      listingStatus: item.ListingStatus,
      quantity: parseInt(item.Quantity || 1, 10),
      quantitySold: parseInt(item.QuantitySold || 0, 10),

      // Time information
      startTime: item.StartTime,
      endTime: item.EndTime,

      // Shipping information
      shipping: {
        cost: parseFloat(
          item.ShippingDetails?.ShippingServiceOptions?.ShippingServiceCost
            ?.__value__ || 0
        ),
        locations: item.ShipToLocations,
      },

      // Seller information
      seller: {
        id: item.Seller?.UserID,
        feedbackScore: parseInt(item.Seller?.FeedbackScore || 0, 10),
        positiveFeedbackPercent: parseFloat(
          item.Seller?.PositiveFeedbackPercent || 0
        ),
      },

      // Item condition
      condition: {
        id: item.ConditionID,
        name: item.ConditionDisplayName,
      },

      // Item specifics (features, specifications)
      specifics: {},
    };

    // Process item specifics if available
    if (item.ItemSpecifics && item.ItemSpecifics.NameValueList) {
      const specifics = Array.isArray(item.ItemSpecifics.NameValueList)
        ? item.ItemSpecifics.NameValueList
        : [item.ItemSpecifics.NameValueList];

      specifics.forEach((spec) => {
        if (spec.Name && (spec.Value || spec.ValueList)) {
          // Handle both single value and value lists
          const value =
            spec.Value ||
            (Array.isArray(spec.ValueList?.Value)
              ? spec.ValueList.Value
              : [spec.ValueList?.Value]);

          itemDetails.specifics[spec.Name] = value;
        }
      });
    }

    // Extract image URLs
    if (item.PictureDetails?.PictureURL) {
      itemDetails.images = Array.isArray(item.PictureDetails.PictureURL)
        ? item.PictureDetails.PictureURL
        : [item.PictureDetails.PictureURL];
    }

    console.log(`Successfully retrieved details for item ${itemId}`);
    return itemDetails;
  } catch (error) {
    // Enhanced error handling with detailed information
    console.error(`Error getting details for item ${itemId}:`, error.message);

    // Log the response for debugging if available
    if (error.response) {
      console.error("API Response Status:", error.response.status);
      console.error("API Response Data:", error.response.data);
    }

    // Throw a more specific error
    throw new Error(`Failed to get item details: ${error.message}`);
  }
}

/**
 * Enhanced fetchCompetitorPrices with rate limiting and retry logic
 * @param {string} itemId - The eBay item ID
 * @param {string} appId - eBay App ID for Finding API
 * @param {string} title - Item title (already fetched)
 * @param {string} categoryId - Item category ID (already fetched)
 * @returns {Promise<Array<number>>} - Array of competitor prices
 */
async function fetchCompetitorPrices(itemId, appId, title, categoryId) {
  // Track retry attempts
  let attempts = 0;
  const maxAttempts = 3;

  // Implement exponential backoff
  const backoff = (attempt) => Math.pow(2, attempt) * 1000; // 1s, 2s, 4s...

  async function attemptFetch() {
    try {
      // Use the Finding API to find similar items
      const xmlRequestBody = `
        <?xml version="1.0" encoding="utf-8"?>
        <findItemsAdvancedRequest xmlns="http://www.ebay.com/marketplace/search/v1/services">
          <keywords>${title}</keywords>
          ${categoryId ? `<categoryId>${categoryId}</categoryId>` : ""}
          <itemFilter>
            <name>ListingType</name>
            <value>FixedPrice</value>
          </itemFilter>
          <sortOrder>PricePlusShippingLowest</sortOrder>
          <paginationInput>
            <entriesPerPage>10</entriesPerPage>
          </paginationInput>
        </findItemsAdvancedRequest>
      `;

      const response = await axios({
        method: "post",
        url: "https://svcs.ebay.com/services/search/FindingService/v1",
        headers: {
          "Content-Type": "text/xml",
          "X-EBAY-SOA-SECURITY-APPNAME": appId,
          "X-EBAY-SOA-OPERATION-NAME": "findItemsAdvanced",
          "X-EBAY-SOA-SERVICE-VERSION": "1.13.0",
          "X-EBAY-SOA-GLOBAL-ID": "EBAY-US",
        },
        data: xmlRequestBody,
      });

      // Parse and process response
      const parser = new xml2js.Parser({
        explicitArray: false,
        tagNameProcessors: [xml2js.processors.stripPrefix],
      });

      const result = await parser.parseStringPromise(response.data);

      // Check for API errors in the response
      if (result.findItemsAdvancedResponse.ack !== "Success") {
        const error = result.findItemsAdvancedResponse.errorMessage?.error;
        if (error) {
          throw new Error(`eBay API Error: ${error.message}`);
        }
      }

      // Extract competitor prices
      const searchResult = result.findItemsAdvancedResponse.searchResult;

      if (searchResult.count === "0") {
        console.log(`No similar items found for item ${itemId}`);
        return [];
      }

      // Process items
      const items = Array.isArray(searchResult.item)
        ? searchResult.item
        : [searchResult.item];

      const competitorPrices = items
        .filter((item) => item.itemId !== itemId) // Exclude our own item
        .map((item) => {
          const price = parseFloat(
            item.sellingStatus?.currentPrice?.__value__ ||
              item.sellingStatus?.currentPrice?.value
          );
          const shippingCost = parseFloat(
            item.shippingInfo?.shippingServiceCost?.__value__ ||
              item.shippingInfo?.shippingServiceCost?.value ||
              0
          );
          return +(price + shippingCost).toFixed(2);
        })
        .filter((price) => !isNaN(price) && price > 0);

      console.log(
        `Found ${competitorPrices.length} competitor prices for item ${itemId}`
      );
      return competitorPrices;
    } catch (error) {
      // Handle rate limiting errors specifically
      if (
        error.response &&
        error.response.status === 500 &&
        error.response.data &&
        error.response.data.includes("RateLimiter")
      ) {
        // If we haven't exceeded max attempts, wait and retry
        if (attempts < maxAttempts) {
          attempts++;
          const waitTime = backoff(attempts);
          console.log(
            `Rate limit hit. Retrying in ${
              waitTime / 1000
            } seconds (attempt ${attempts}/${maxAttempts})...`
          );

          // Wait using setTimeout wrapped in a promise
          await new Promise((resolve) => setTimeout(resolve, waitTime));

          // Try again recursively
          return attemptFetch();
        } else {
          // If we've exhausted our retries, use cached data or fail gracefully
          console.error(
            `Rate limit exceeded after ${maxAttempts} attempts. Using fallback.`
          );
          return []; // Or return cached data if available
        }
      }

      // For other errors, just propagate them
      throw error;
    }
  }

  // Start the first attempt
  return attemptFetch();
}

/**
 * Add caching to competitor price fetching
 */
async function fetchCompetitorPricesWithCache(
  itemId,
  appId,
  title,
  categoryId
) {
  const cacheKey = `${itemId}_${title}`;

  // Check if we have a valid cache entry
  if (cache[cacheKey] && cache[cacheKey].timestamp > Date.now() - CACHE_TTL) {
    console.log(`Using cached prices for ${itemId}`);
    return cache[cacheKey].prices;
  }

  // If not cached or expired, fetch fresh data
  const prices = await fetchCompetitorPrices(itemId, appId, title, categoryId);

  // Cache the result
  cache[cacheKey] = {
    timestamp: Date.now(),
    prices,
  };

  return prices;
}

// Create a limiter for eBay API
const ebayLimiter = new Bottleneck({
  minTime: 200, // Min 200ms between requests (5/second)
  maxConcurrent: 1, // Only 1 request at a time
  highWater: 100, // Max 100 jobs queued
  strategy: Bottleneck.strategy.LEAK, // Discard oldest jobs when queue is full
});

// Wrap fetch functions with the limiter
const throttledFetchCompetitorPrices = ebayLimiter.wrap(fetchCompetitorPrices);
const throttledGetItemDetails = ebayLimiter.wrap(getItemDetails);

/**
 * Pricing Strategy Implementations
 */

// 1. Match Lowest Strategy
function matchLowest(currentPrice, competitorPrices) {
  if (!competitorPrices || competitorPrices.length === 0) {
    return {
      success: false,
      message: "No competitor prices available",
      newPrice: currentPrice,
    };
  }

  const lowestPrice = Math.min(...competitorPrices);

  return {
    success: true,
    message: "Price matched to lowest competitor",
    oldPrice: currentPrice,
    newPrice: lowestPrice,
    strategy: "MATCH_LOWEST",
    competitorPrices,
  };
}

// 2. Beat Lowest Strategy
function beatLowestByAmount(currentPrice, competitorPrices, amount) {
  if (!competitorPrices || competitorPrices.length === 0) {
    return {
      success: false,
      message: "No competitor prices available",
      newPrice: currentPrice,
    };
  }

  if (typeof amount !== "number" || amount <= 0) {
    return {
      success: false,
      message: "Invalid amount: Must be a positive number",
      newPrice: currentPrice,
    };
  }

  const lowestPrice = Math.min(...competitorPrices);
  const newPrice = lowestPrice - amount;

  // Don't allow negative prices
  if (newPrice <= 0) {
    return {
      success: false,
      message: "Calculated price would be zero or negative",
      oldPrice: currentPrice,
      calculatedPrice: newPrice,
      newPrice: currentPrice,
      competitorPrices,
    };
  }

  return {
    success: true,
    message: `Price set to $${amount.toFixed(2)} below lowest competitor`,
    oldPrice: currentPrice,
    newPrice: newPrice,
    strategy: "BEAT_LOWEST",
    strategyParams: { amount },
    competitorPrices,
  };
}

// 3. Stay Above Strategy
function stayAbove(currentPrice, competitorPrices, params) {
  if (!competitorPrices || competitorPrices.length === 0) {
    return {
      success: false,
      message: "No competitor prices available",
      newPrice: currentPrice,
    };
  }

  const { percentage, amount } = params;

  // Validate parameters
  if (
    (typeof percentage !== "number" && typeof amount !== "number") ||
    (typeof percentage === "number" && percentage < 0) ||
    (typeof amount === "number" && amount < 0)
  ) {
    return {
      success: false,
      message: "Invalid parameters: Requires valid percentage or amount",
      newPrice: currentPrice,
    };
  }

  const lowestPrice = Math.min(...competitorPrices);
  let newPrice;
  let description;

  if (typeof percentage === "number") {
    newPrice = lowestPrice * (1 + percentage / 100);
    description = `${percentage}% above`;
  } else {
    newPrice = lowestPrice + amount;
    description = `$${amount.toFixed(2)} above`;
  }

  return {
    success: true,
    message: `Price set to ${description} lowest competitor`,
    oldPrice: currentPrice,
    newPrice: newPrice,
    strategy: "STAY_ABOVE",
    strategyParams: params,
    competitorPrices,
  };
}

// Validation helper
function validatePriceResult(result, constraints = {}) {
  const { newPrice } = result;
  const { minPrice, maxPrice, maxChange } = constraints;

  // Already failed
  if (!result.success) return result;

  // Check minimum price constraint
  if (minPrice && newPrice < minPrice) {
    return {
      ...result,
      success: false,
      message: `Calculated price ${newPrice.toFixed(
        2
      )} is below minimum allowed ${minPrice.toFixed(2)}`,
      calculatedPrice: newPrice,
      newPrice: result.oldPrice,
    };
  }

  // Check maximum price constraint
  if (maxPrice && newPrice > maxPrice) {
    return {
      ...result,
      success: false,
      message: `Calculated price ${newPrice.toFixed(
        2
      )} is above maximum allowed ${maxPrice.toFixed(2)}`,
      calculatedPrice: newPrice,
      newPrice: result.oldPrice,
    };
  }

  // Check maximum price change
  if (maxChange && Math.abs(newPrice - result.oldPrice) > maxChange) {
    return {
      ...result,
      success: false,
      message: `Price change of ${Math.abs(newPrice - result.oldPrice).toFixed(
        2
      )} exceeds maximum allowed change of ${maxChange.toFixed(2)}`,
      calculatedPrice: newPrice,
      newPrice: result.oldPrice,
    };
  }

  return result;
}


// Example with MongoDB (pseudo-code)
async function getCachedDataFromDB(key) {
  const cachedItem = await CacheCollection.findOne({ key });
  if (cachedItem && cachedItem.expires > Date.now()) {
    return cachedItem.data;
  }
  return null;
}

async function setCachedDataInDB(key, data, ttlSeconds = 86400) {
  await CacheCollection.updateOne(
    { key },
    { 
      $set: { 
        data, 
        expires: Date.now() + (ttlSeconds * 1000),
        isMock: false
      }
    },
    { upsert: true }
  );
}
/**
 * Helper function to get item details and competitor prices
 */
async function getItemDetailsAndPrices(itemId, oauthToken, appId) {
  // Step 1: Get item details using OAuth token
  const itemDetails = await throttledGetItemDetails(itemId, oauthToken);

  // Step 2: Get competitor prices using App ID and details already fetched
  const competitorPrices = await fetchCompetitorPricesWithCache(
    itemId,
    appId,
    itemDetails.title,
    itemDetails.category?.id
  );

  return { itemDetails, competitorPrices };
}

/**
 * API Routes
 */
route.get("/competitor-prices/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const oauthToken = process.env.AUTH_TOKEN; // For Trading API
    const appId = process.env.CLIENT_ID; // For Finding API

    console.log(`Fetching prices for item id => ${itemId}`);

    const { itemDetails, competitorPrices } = await getItemDetailsAndPrices(
      itemId,
      oauthToken,
      appId
    );

    res.json({
      success: true,
      itemId,
      itemTitle: itemDetails.title,
      competitorPrices,
      dataSource: isMockData ? "mock" : (cache[`${itemId}_prices`] ? "cached" : "live")
    });
  } catch (error) {
    console.error("Error fetching competitor prices:", error);
    
    // Better error handling with more specific messages
    if (error.message.includes("Rate")) {
      return res.status(429).json({
        success: false,
        message: "eBay API rate limit exceeded. Please try again later.",
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: "Failed to fetch competitor prices",
      error: error.message
    });
  }
}); 

// 1. Match Lowest Strategy Endpoint
route.post("/match-lowest", async (req, res) => {
  try {
    const {
      itemId,
      currentPrice,
      apiKey, 
      constraints,
      useProvidedPrices = false,
      competitorPrices: providedPrices = [],
    } = req.body;

    if (typeof currentPrice !== "number" || currentPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid current price",
      });
    }

    if (!itemId && !useProvidedPrices) {
      return res.status(400).json({
        success: false,
        message: "Item ID is required when not using provided prices",
      });
    }

    // Use provided prices or fetch from eBay
    let competitorPrices;
    if (useProvidedPrices) {
      competitorPrices = providedPrices;
    } else {
      const oauthToken = process.env.AUTH_TOKEN;
      const appId = process.env.CLIENT_ID;

      const { itemDetails, competitorPrices: fetchedPrices } =
        await getItemDetailsAndPrices(itemId, oauthToken, appId);
      competitorPrices = fetchedPrices;
    }

    const result = matchLowest(currentPrice, competitorPrices);
    const validatedResult = validatePriceResult(result, constraints);

    res.json({
      ...validatedResult,
      itemId,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 2. Beat Lowest Strategy Endpoint
route.post("/beat-lowest", async (req, res) => {
  try {
    const {
      itemId,
      currentPrice,
      amount,
      constraints,
      useProvidedPrices = false,
      competitorPrices: providedPrices = [],
    } = req.body;

    if (typeof currentPrice !== "number" || currentPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid current price",
      });
    }

    if (!itemId && !useProvidedPrices) {
      return res.status(400).json({
        success: false,
        message: "Item ID is required when not using provided prices",
      });
    }

    // Use provided prices or fetch from eBay
    let competitorPrices;
    if (useProvidedPrices) {
      competitorPrices = providedPrices;
    } else {
      const oauthToken = process.env.AUTH_TOKEN;
      const appId = process.env.CLIENT_ID;

      const { itemDetails, competitorPrices: fetchedPrices } =
        await getItemDetailsAndPrices(itemId, oauthToken, appId);
      competitorPrices = fetchedPrices;
    }

    const result = beatLowestByAmount(currentPrice, competitorPrices, amount);
    const validatedResult = validatePriceResult(result, constraints);

    res.json({
      ...validatedResult,
      itemId,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 3. Stay Above Strategy Endpoint
route.post("/stay-above", async (req, res) => {
  try {
    const {
      itemId,
      currentPrice,
      percentage,
      amount,
      constraints,
      useProvidedPrices = false,
      competitorPrices: providedPrices = [],
    } = req.body;

    if (typeof currentPrice !== "number" || currentPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid current price",
      });
    }

    if (!itemId && !useProvidedPrices) {
      return res.status(400).json({
        success: false,
        message: "Item ID is required when not using provided prices",
      });
    }

    // Use provided prices or fetch from eBay
    let competitorPrices;
    if (useProvidedPrices) {
      competitorPrices = providedPrices;
    } else {
      const oauthToken = process.env.AUTH_TOKEN;
      const appId = process.env.CLIENT_ID;

      const { itemDetails, competitorPrices: fetchedPrices } =
        await getItemDetailsAndPrices(itemId, oauthToken, appId);
      competitorPrices = fetchedPrices;
    }

    const params = {};
    if (typeof percentage === "number") params.percentage = percentage;
    if (typeof amount === "number") params.amount = amount;

    const result = stayAbove(currentPrice, competitorPrices, params);
    const validatedResult = validatePriceResult(result, constraints);

    res.json({
      ...validatedResult,
      itemId,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Process batch of items with the same strategy
route.post("/batch-process", async (req, res) => {
  try {
    const { items, strategy, strategyParams, constraints } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Items must be a non-empty array",
      });
    }

    if (
      !strategy ||
      !["MATCH_LOWEST", "BEAT_LOWEST", "STAY_ABOVE"].includes(strategy)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid strategy",
      });
    }

    const oauthToken = process.env.AUTH_TOKEN;
    const appId = process.env.CLIENT_ID;
    const results = [];

    for (const item of items) {
      try {
        const { itemId, currentPrice } = item;

        if (!itemId || typeof currentPrice !== "number" || currentPrice <= 0) {
          results.push({
            success: false,
            message: "Invalid item data",
            itemId: item.itemId || "unknown",
          });
          continue;
        }

        // Fetch item details and competitor prices
        const { itemDetails, competitorPrices } = await getItemDetailsAndPrices(
          itemId,
          oauthToken,
          appId
        );

        // Apply the selected strategy
        let result;

        if (strategy === "MATCH_LOWEST") {
          result = matchLowest(currentPrice, competitorPrices);
        } else if (strategy === "BEAT_LOWEST") {
          const { amount } = strategyParams || {};
          result = beatLowestByAmount(currentPrice, competitorPrices, amount);
        } else if (strategy === "STAY_ABOVE") {
          const { percentage, amount } = strategyParams || {};
          result = stayAbove(currentPrice, competitorPrices, {
            percentage,
            amount,
          });
        }

        // Validate the result
        const validatedResult = validatePriceResult(result, constraints);

        results.push({
          ...validatedResult,
          itemId,
          itemTitle: itemDetails.title,
        });
      } catch (error) {
        results.push({
          success: false,
          message: error.message,
          itemId: item.itemId || "unknown",
        });
      }
    }

    // Calculate summary
    const successful = results.filter((r) => r.success).length;

    res.json({
      success: true,
      summary: {
        total: items.length,
        successful,
        failed: items.length - successful,
      },
      results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Error handling middleware
route.use((err, req, res, next) => {
  console.error("API Error:", err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

export default route;
