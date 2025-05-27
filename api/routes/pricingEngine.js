import express from "express";
import xml2js from "xml2js";
import axios from "axios";
import Bottleneck from "bottleneck";

// Initialize Express app
const route = express.Router();

// Simple in-memory cache
const cache = {};
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

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

// Get competitor prices endpoint
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
    });
  } catch (error) {
    console.error("Error fetching competitor prices:", error);
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
