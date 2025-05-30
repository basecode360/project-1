import express from "express";
import xml2js from "xml2js";
import axios from "axios";
import Bottleneck from "bottleneck";

// Initialize Express app
const route = express.Router();

// Middleware
const limiter = new Bottleneck({
  minTime: 333, // Min 333ms between requests (3/second max)
  maxConcurrent: 1, // Only 1 request at a time
});

// Wrap your API functions
const throttledFetchCompetitorPrices = limiter.wrap(fetchCompetitorPrices);

// Simple in-memory cache
async function fetchCompetitorPrices(itemId, title, categoryId, accessToken) {
  try {
    const query = new URLSearchParams({
      q: title,
      category_ids: categoryId,
      limit: 20,
      sort: "price",
    });

    const response = await axios.get(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${query.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const items = response.data.itemSummaries || [];

    const competitorPrices = items
      .filter((item) => item.itemId !== itemId) // optionally exclude your own item
      .map((item) => {
        const price = parseFloat(item.price.value);

        const shipping = parseFloat(
          item.shippingOptions?.[0]?.shippingCost?.value || "0"
        );
        return +(price + shipping).toFixed(2);
      })
      .filter((price) => !isNaN(price) && price > 0);

    console.log(`Found ${competitorPrices.length} competitor prices`);

    const productData = items
  .filter((item) => item.itemId !== itemId) // optionally exclude your own item
  .map((item) => {
    const productInfo = {
      id: item.itemId,
      title: item.title,
      category: item.categories,
      imageurl: item.thumbnailImages[0]?.imageUrl || "",
      currency: item.price?.currency || "USD",
      username: item.seller?.username || "Unknown Seller",
      feedbackPercentage: item.seller?.feedbackPercentage ?? null,
      feedbackScore: item.seller?.feedbackScore ?? null,
      condition: item.condition,
      buyingOptions: item.buyingOptions,
      productUrl: item.itemWebUrl,
      locale: item.itemLocation?.country || "US",
      price : item.price?.value || 0,
    };
    return productInfo;
  });

      

    console.log(`Found ${productData} product`);

    return {
      allData: productData,
      lowestPrice: Math.min(...competitorPrices),
      allPrices: competitorPrices,
      response: response.data,
    };

  } catch (error) {
    console.error("Browse API Error:", error.response?.data || error.message);

    if (
      error.response?.status === 429 ||
      error.response?.data?.includes("rate limit")
    ) {
      throw new Error("eBay API rate limit hit — try again later.");
    }

    throw new Error("Failed to fetch competitor prices from eBay Browse API.");
  }
}

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
    expires: Date.now() + ttlSeconds * 1000,
    isMock,
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
    const variation = 0.85 + ((seed * (i + 1)) % 30) / 100;
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
// const throttledFetchCompetitorPrices = ebayLimiter.wrap(fetchCompetitorPrices);
const throttledGetItemDetails = ebayLimiter.wrap(getItemDetails);

/**
 * Pricing Strategy Implementations
 */

// 1. Match Lowest Strategy
function matchLowest(currentPrice, competitorPrices) {
  if (!Array.isArray(competitorPrices)) {
    console.warn('competitorPrices is not an array:', competitorPrices);
    return { success: false, message: 'Invalid competitor prices data' };
  }
  
  if (!competitorPrices || competitorPrices.length === 0) {
    return {
      success: false,
      message: "No competitor prices available",
      newPrice: currentPrice,
    };
  }

  // ✅ Handle both arrays of numbers and arrays of objects
  let lowestPrice;
  
  try {
    // Check if first element is a number or object
    if (typeof competitorPrices[0] === 'number') {
      // Array of numbers: [89.99, 95.50, 87.00]
      lowestPrice = Math.min(...competitorPrices);
    } else if (competitorPrices[0] && typeof competitorPrices[0] === 'object') {
      // Array of objects: [{price: 89.99}, {price: 95.50}]
      const prices = competitorPrices
        .map(item => item.price || item.value || item.amount || 0)
        .filter(price => price > 0);
      
      if (prices.length === 0) {
        return {
          success: false,
          message: "No valid competitor prices found",
          newPrice: currentPrice,
        };
      }
      
      lowestPrice = Math.min(...prices);
    } else {
      throw new Error('Invalid competitor price format');
    }
  } catch (error) {
    console.error('Error processing competitor prices:', error);
    console.log('competitorPrices sample:', competitorPrices.slice(0, 3));
    return {
      success: false,
      message: "Error processing competitor prices: " + error.message,
      newPrice: currentPrice,
    };
  }

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
function stayAbove(currentPrice, competitorPrices, params = {}) {
  // ✅ Guard against non-arrays
  if (!Array.isArray(competitorPrices)) {
    console.warn('competitorPrices is not an array:', competitorPrices);
    return { success: false, message: 'Invalid competitor prices data' };
  }

  // ✅ Handle empty arrays
  if (competitorPrices.length === 0) {
    return {
      success: false,
      message: "No competitor prices available",
      newPrice: currentPrice,
    };
  }

  // ✅ Extract numeric values safely
  const prices = competitorPrices.map(item => {
    if (typeof item === 'number') return item;
    if (typeof item === 'object') return item.price || item.value || item.amount || 0;
    return parseFloat(item) || 0;
  }).filter(price => price > 0);

  if (prices.length === 0) {
    return {
      success: false,
      message: "No valid competitor prices found",
      newPrice: currentPrice,
    };
  }

  // Find lowest competitor price
  const lowestPrice = Math.min(...prices);
  
  let newPrice;
  const { percentage, amount } = params;

  if (percentage && typeof percentage === 'number') {
    // Stay above by percentage
    newPrice = lowestPrice * (1 + percentage);
  } else if (amount && typeof amount === 'number') {
    // Stay above by fixed amount
    newPrice = lowestPrice + amount;
  } else {
    return {
      success: false,
      message: "Either percentage or amount parameter is required",
      newPrice: currentPrice,
    };
  }

  return {
    success: true,
    message: `Price set to stay above competitors`,
    oldPrice: currentPrice,
    newPrice: parseFloat(newPrice.toFixed(2)),
    strategy: "STAY_ABOVE",
    lowestCompetitorPrice: lowestPrice,
    competitorPrices: prices,
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
        expires: Date.now() + ttlSeconds * 1000,
        isMock: false,
      },
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
  const competitorPrices = await fetchCompetitorPrices(
    itemDetails.itemId,
    itemDetails.title,
    itemDetails.category.id,
    process.env.AUTH_TOKEN
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

    const cacheKey = `${itemId}_prices`;
    const isMock = cache[cacheKey]?.isMock || false;

    res.json({
      // allData,
      success: true,
      itemId,
      itemTitle: itemDetails.title,
      competitorPrices,
      dataSource: isMock ? "mock" : cache[cacheKey] ? "cached" : "live",
    });
  } catch (error) {
    console.error("Error fetching competitor prices:", error);

    if (error.message.includes("Rate")) {
      return res.status(429).json({
        success: false,
        message: "eBay API rate limit exceeded. Please try again later.",
        error: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to fetch competitor prices",
      error: error.message,
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

    let competitorPrices;
    if (useProvidedPrices) {
      // ✅ Ensure providedPrices is always an array
      competitorPrices = Array.isArray(providedPrices) ? providedPrices : [];
    } else {
      const oauthToken = process.env.AUTH_TOKEN;
      const appId = process.env.CLIENT_ID;

      const { itemDetails, competitorPrices: fetchedPrices } =
        await getItemDetailsAndPrices(itemId, oauthToken, appId);
      
      // ✅ Ensure fetchedPrices is always an array
      competitorPrices = Array.isArray(fetchedPrices) ? fetchedPrices : [];
    }

    // ✅ Add debug logging
    console.log('competitorPrices type:', typeof competitorPrices);
    console.log('competitorPrices isArray:', Array.isArray(competitorPrices));
    console.log('competitorPrices length:', competitorPrices?.length);

    const result = matchLowest(currentPrice, competitorPrices);
    const validatedResult = validatePriceResult(result, constraints);

    res.json({
      ...validatedResult,
      itemId,
    });
  } catch (error) {
    console.error('Full error stack:', error); // ✅ Better error logging
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
      // ✅ Ensure it's always an array
      competitorPrices = Array.isArray(providedPrices) ? providedPrices : [];
    } else {
      const oauthToken = process.env.AUTH_TOKEN;
      const appId = process.env.CLIENT_ID;

      const { itemDetails, competitorPrices: fetchedPrices } =
        await getItemDetailsAndPrices(itemId, oauthToken, appId);
      
      // ✅ Ensure fetchedPrices is always an array
      competitorPrices = Array.isArray(fetchedPrices) ? fetchedPrices : [];
    }

    // ✅ Add debug logging
    console.log('competitorPrices type:', typeof competitorPrices);
    console.log('competitorPrices isArray:', Array.isArray(competitorPrices));
    console.log('competitorPrices sample:', competitorPrices?.slice(0, 3));

    const params = {};
    if (typeof percentage === "number") params.percentage = percentage;
    if (typeof amount === "number") params.amount = amount;

    console.log('params:', params); // ✅ Debug params

    const result = stayAbove(currentPrice, competitorPrices, params);
    const validatedResult = validatePriceResult(result, constraints);

    res.json({
      ...validatedResult,
      itemId,
    });
  } catch (error) {
    console.error('Full error stack:', error); // ✅ Better error logging
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
