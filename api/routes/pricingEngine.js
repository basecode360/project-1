import express from "express";
import xml2js from "xml2js";
import axios from "axios";
import Bottleneck from "bottleneck";

// Initialize Express app
const router = express.Router();


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


// Optional: Generate mock data for testing when rate limited


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
 * ORIGINAL API Routes (Updated to work with strategy system)
 */
const cache = {};
router.get("/competitor-prices/:itemId", async (req, res) => {
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


/**
 * ===============================
 * PRICING STRATEGIES API
 * ===============================
 * 
 * This file contains all pricing strategy management APIs:
 * - Create pricing strategy on specific product
 * - Create pricing strategy and assign to all active listings
 * - Fetch pricing strategies from specific product
 * - Fetch all active listings with pricing strategies
 * - Update pricing strategy on specific product
 * - Delete pricing strategy from specific product
 * - Delete pricing strategies from all active listings
 * - Apply strategy to update product price
 */

/**
 * Helper Functions
 */

// Parse XML response helper
async function parseXMLResponse(xmlData) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    tagNameProcessors: [xml2js.processors.stripPrefix],
  });
  return await parser.parseStringPromise(xmlData);
}

// Check if eBay API response is successful
function isEBayResponseSuccessful(result, operationName) {
  const response = result[operationName + 'Response'];
  if (response.Ack !== "Success" && response.Ack !== "Warning") {
    const errors = response.Errors;
    const errorMsg = Array.isArray(errors)
      ? errors.map((e) => e.LongMessage || e.ShortMessage).join(", ")
      : errors?.LongMessage || errors?.ShortMessage || "Unknown error";
    throw new Error(`eBay API Error: ${errorMsg}`);
  }
  return response;
}

// Make eBay XML API call
async function makeEBayAPICall(xmlRequest, callName) {
  const response = await axios({
    method: "post",
    url: "https://api.ebay.com/ws/api.dll",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1155",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": "0", // US site
    },
    data: xmlRequest,
  });
  return response.data;
}


// Parse pricing strategy data from ItemSpecifics
function parsePricingStrategyFromSpecifics(itemSpecifics, itemId) {
  // Filter for strategy-related specifics
  const strategyRelatedSpecifics = itemSpecifics.filter(spec => 
    spec.Name === "PricingStrategyName" ||
    spec.Name === "RepricingRule" ||
    spec.Name === "IsPricingStrategy" ||
    spec.Name === "MaxPrice" ||
    spec.Name === "MinPrice" ||
    spec.Name === "BeatBy" ||
    spec.Name === "BeatValue" ||
    spec.Name === "StayAboveBy" ||
    spec.Name === "StayAboveValue" ||
    spec.Name === "NoCompetitionAction"
  );
  
  // Check if we have any strategy data
  if (!strategyRelatedSpecifics.length || !itemSpecifics.some(spec => spec.Name === "IsPricingStrategy")) {
    console.log(`[Debug] No pricing strategy found for item ${itemId}`);
    return null;
  }

  // Improved findValue function that properly handles different response formats
const findValue = (name) => {
  const spec = itemSpecifics.find(s => s.Name === name);
  if (!spec) return null;
  
  console.log(`[Debug] Finding value for ${name}:`, spec);
  console.log(`[Debug] Value type for ${name}:`, typeof spec.Value);
  
  // Handle different possible value formats from eBay API
  if (typeof spec.Value === 'string') {
    return spec.Value;
  } else if (Array.isArray(spec.Value)) {
    return spec.Value[0] || '';
  } else if (spec.Value && typeof spec.Value === 'object') {
    // Some XML parsers might return objects
    return spec.Value.toString();
  }
  return null;};
  // Extract strategy data
  const strategyName = findValue("PricingStrategyName");
  const repricingRule = findValue("RepricingRule");
  
  if (!strategyName || !repricingRule) {
    console.log(`[Debug] Missing required strategy fields for item ${itemId}`);
    return null;
  }

  // Build the strategy object
  const strategy = {
    name: strategyName,
    repricingRule: repricingRule,
    noCompetitionAction: findValue("NoCompetitionAction") || "USE_MAX_PRICE"
  };

  // Add rule-specific parameters
  if (repricingRule === "BEAT_LOWEST") {
    strategy.beatBy = findValue("BeatBy");
    const beatValue = findValue("BeatValue");
    strategy.value = beatValue ? parseFloat(beatValue) : null;
  }

  if (repricingRule === "STAY_ABOVE") {
    strategy.stayAboveBy = findValue("StayAboveBy");
    const stayAboveValue = findValue("StayAboveValue");
    strategy.value = stayAboveValue ? parseFloat(stayAboveValue) : null;
  }

  // Add price limits
  const maxPrice = findValue("MaxPrice");
  if (maxPrice) {
    strategy.maxPrice = parseFloat(maxPrice);
  }

  const minPrice = findValue("MinPrice");
  if (minPrice) {
    strategy.minPrice = parseFloat(minPrice);
  }

  return strategy;
}
// Helper function to map your strategy types to standard repricing rules
function mapStrategyToRepricingRule(strategyData) {
  // Check if it's the new format first
  if (strategyData.RepricingRule) {
    return strategyData.RepricingRule; // MATCH_LOWEST, BEAT_LOWEST, STAY_ABOVE
  }

  // Map your existing strategy types to standard rules
  const strategyType = strategyData.PricingStrategy?.toLowerCase();
  
  switch (strategyType) {
    case 'time-based':
      return 'TIME_BASED';
    case 'competitive':
      return 'COMPETITIVE';
    case 'dynamic':
      return 'DYNAMIC';
    case 'fixed':
      return 'FIXED';
    case 'match-lowest':
    case 'match_lowest':
      return 'MATCH_LOWEST';
    case 'beat-lowest':
    case 'beat_lowest':
      return 'BEAT_LOWEST';
    case 'stay-above':
    case 'stay_above':
      return 'STAY_ABOVE';
    default:
      return strategyData.PricingStrategy || 'UNKNOWN';
  }
}

// Updated API endpoint with the fixed parser
router.get("/products/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required"
      });
    }

    const xmlRequest = `
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

    const xmlResponse = await makeEBayAPICall(xmlRequest, "GetItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "GetItem");

    const item = response.Item;
    if (!item) {
      throw new Error(`Item ${itemId} not found`);
    }

    // Extract pricing strategy data from ItemSpecifics
    const itemSpecifics = item.ItemSpecifics?.NameValueList || [];
    console.log(`[Debug] All item specifics for ${itemId}:`, JSON.stringify(itemSpecifics));
    
    const pricingStrategy = parsePricingStrategyFromSpecifics(itemSpecifics, itemId);
    const hasPricingStrategy = pricingStrategy !== null;

    // Add debug info
    const strategyRelatedSpecificsCount = itemSpecifics.filter(spec => 
      spec.Name === "PricingStrategyName" ||
      spec.Name === "RepricingRule" ||
      spec.Name === "IsPricingStrategy"
    ).length;

    res.json({
      success: true,
      itemId,
      itemTitle: item.Title,
      hasPricingStrategy,
      pricingStrategy,
      itemDetails: {
        currentPrice: item.StartPrice?.Value || item.StartPrice?.__value__ || 0,
        currency: item.StartPrice?.__attributes__?.currencyID || item.Currency || "USD",
        listingType: item.ListingType,
        condition: item.ConditionDisplayName
      },
      debug: {
        totalItemSpecifics: itemSpecifics.length,
        hasAnyStrategyData: strategyRelatedSpecificsCount > 0,
        strategyRelatedSpecificsCount,
        allItemSpecifics: itemSpecifics.map(spec => ({ name: spec.Name, value: spec.Value }))
      }
    });

  } catch (error) {
    console.error("eBay Pricing Strategy Fetch Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ===============================
// ALSO UPDATE YOUR CREATE STRATEGY TO USE CONSISTENT FIELD NAMES
// ===============================

// Updated createPricingStrategySpecifics function to match your existing data format
function createPricingStrategySpecifics({
  strategyName,
  repricingRule,
  beatBy,
  stayAboveBy,
  value,
  noCompetitionAction = "USE_MAX_PRICE",
  maxPrice,
  minPrice
}) {
  // Create basic strategy specifics
  const specifics = [
    { name: "PricingStrategyName", value: strategyName },
    { name: "RepricingRule", value: repricingRule },
    { name: "NoCompetitionAction", value: noCompetitionAction }
  ];

  // Add rule-specific parameters
  if (repricingRule === "BEAT_LOWEST" && beatBy) {
    specifics.push({ name: "BeatBy", value: beatBy });
    if (value !== undefined) {
      specifics.push({ name: "BeatValue", value: value.toString() });
    }
  }

  if (repricingRule === "STAY_ABOVE" && stayAboveBy) {
    specifics.push({ name: "StayAboveBy", value: stayAboveBy });
    if (value !== undefined) {
      specifics.push({ name: "StayAboveValue", value: value.toString() });
    }
  }

  // Add price limits
  if (maxPrice !== undefined) {
    specifics.push({ name: "MaxPrice", value: maxPrice.toString() });
  }

  if (minPrice !== undefined) {
    specifics.push({ name: "MinPrice", value: minPrice.toString() });
  }

  // Add a unique identifier to ensure this is recognized as a pricing strategy
  specifics.push({ name: "IsPricingStrategy", value: "true" });
  
  return specifics;
}
/**
 * ===============================
 * 1. CREATE PRICING STRATEGY ON SPECIFIC PRODUCT
 * ===============================
 */

router.post("/products/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const {
      strategyName,
      repricingRule,
      beatBy,
      stayAboveBy,
      value,
      noCompetitionAction = "USE_MAX_PRICE",
      maxPrice,
      minPrice
    } = req.body;

    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required"
      });
    }

    if (!strategyName || !repricingRule) {
      return res.status(400).json({
        success: false,
        message: "Strategy name and repricing rule are required"
      });
    }

    if (!["MATCH_LOWEST", "BEAT_LOWEST", "STAY_ABOVE"].includes(repricingRule)) {
      return res.status(400).json({
        success: false,
        message: "Invalid repricing rule. Must be MATCH_LOWEST, BEAT_LOWEST, or STAY_ABOVE"
      });
    }

    // Validate strategy-specific parameters
    if (repricingRule === "BEAT_LOWEST" && (!beatBy || !value)) {
      return res.status(400).json({
        success: false,
        message: "Beat by method and value are required for BEAT_LOWEST strategy"
      });
    }

    if (repricingRule === "STAY_ABOVE" && (!stayAboveBy || !value)) {
      return res.status(400).json({
        success: false,
        message: "Stay above method and value are required for STAY_ABOVE strategy"
      });
    }

    if (value !== undefined && (typeof value !== "number" || value <= 0)) {
      return res.status(400).json({
        success: false,
        message: "Value must be a positive number"
      });
    }

    // Create pricing strategy specifics
    const strategySpecifics = createPricingStrategySpecifics(req.body);

    const xmlRequest = `
      <?xml version="1.0" encoding="utf-8"?>
      <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <Item>
          <ItemID>${itemId}</ItemID>
          <ItemSpecifics>
            <!-- Add required Brand and Type fields to avoid eBay errors -->
            <NameValueList>
              <Name>Brand</Name>
              <Value>YourBrandName</Value>
            </NameValueList>
            <NameValueList>
              <Name>Type</Name>
              <Value>YourTypeName</Value>
            </NameValueList>
            ${strategySpecifics.map(spec => `
            <NameValueList>
              <Name>${spec.name}</Name>
              <Value>${spec.value}</Value>
            </NameValueList>
            `).join('')}
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "ReviseItem");

    res.json({
      success: true,
      message: "Pricing strategy created successfully on eBay product",
      itemId,
      strategy: {
        name: strategyName,
        repricingRule,
        beatBy,
        stayAboveBy,
        value,
        noCompetitionAction,
        maxPrice,
        minPrice
      },
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime
      }
    });

  } catch (error) {
    console.error("eBay Pricing Strategy Creation Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});
/**
 * ===============================
 * 2. CREATE PRICING STRATEGY AND ASSIGN TO ALL ACTIVE LISTINGS
 * ===============================
 */

router.post("/assign-to-all-active", async (req, res) => {
  try {
    const {
      strategyName,
      repricingRule,
      beatBy,
      stayAboveBy,
      value,
      noCompetitionAction = "USE_MAX_PRICE",
      maxPrice,
      minPrice
    } = req.body;

    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required"
      });
    }

    if (!strategyName || !repricingRule) {
      return res.status(400).json({
        success: false,
        message: "Strategy name and repricing rule are required"
      });
    }

    // Step 1: Get all active listings
    const getActiveListingsXML = `
      <?xml version="1.0" encoding="utf-8"?>
      <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <ActiveList>
          <Include>true</Include>
          <Pagination>
            <EntriesPerPage>200</EntriesPerPage>
            <PageNumber>1</PageNumber>
          </Pagination>
        </ActiveList>
        <DetailLevel>ReturnAll</DetailLevel>
      </GetMyeBaySellingRequest>
    `;

    console.log("Fetching active listings for pricing strategy assignment...");
    const activeListingsResponse = await makeEBayAPICall(getActiveListingsXML, "GetMyeBaySelling");
    const activeListingsResult = await parseXMLResponse(activeListingsResponse);
    const activeListingsData = isEBayResponseSuccessful(activeListingsResult, "GetMyeBaySelling");

    const activeList = activeListingsData.ActiveList;
    if (!activeList || !activeList.ItemArray) {
      return res.json({
        success: true,
        message: "No active listings found",
        assignedCount: 0,
        listings: []
      });
    }

    const items = Array.isArray(activeList.ItemArray.Item) 
      ? activeList.ItemArray.Item 
      : [activeList.ItemArray.Item];

    console.log(`Found ${items.length} active listings for pricing strategy assignment`);

    // Step 2: Create pricing strategy specifics
    const strategySpecifics = createPricingStrategySpecifics(req.body);
    strategySpecifics.push({ name: "AssignedToAllActiveListings", value: "true" });

    // Step 3: Apply pricing strategy to each active listing
    const results = [];
    const errors = [];

    for (const item of items) {
      try {
        const itemId = item.ItemID;
        
        console.log(`Applying pricing strategy to item ${itemId}...`);

        const xmlRequest = `
          <?xml version="1.0" encoding="utf-8"?>
          <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
            <RequesterCredentials>
              <eBayAuthToken>${authToken}</eBayAuthToken>
            </RequesterCredentials>
            <Item>
              <ItemID>${itemId}</ItemID>
              <ItemSpecifics>
                ${strategySpecifics.map(spec => `
                <NameValueList>
                  <n>${spec.name}</n>
                  <Value>${spec.value}</Value>
                </NameValueList>
                `).join('')}
              </ItemSpecifics>
            </Item>
          </ReviseItemRequest>
        `;

        const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
        const result = await parseXMLResponse(xmlResponse);
        isEBayResponseSuccessful(result, "ReviseItem");

        results.push({
          itemId,
          title: item.Title,
          success: true,
          message: "Pricing strategy applied successfully"
        });

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`Error applying pricing strategy to item ${item.ItemID}:`, error.message);
        errors.push({
          itemId: item.ItemID,
          title: item.Title,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.length;
    const errorCount = errors.length;

    res.json({
      success: true,
      message: `Pricing strategy assigned to ${successCount} of ${items.length} active listings`,
      strategy: {
        name: strategyName,
        repricingRule,
        beatBy,
        stayAboveBy,
        value,
        noCompetitionAction,
        maxPrice,
        minPrice
      },
      summary: {
        totalActiveListings: items.length,
        successfulAssignments: successCount,
        failedAssignments: errorCount
      },
      successfulAssignments: results,
      failedAssignments: errors
    });

  } catch (error) {
    console.error("eBay Bulk Pricing Strategy Assignment Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * ===============================
 * 3. FETCH PRICING STRATEGY FROM SPECIFIC PRODUCT
 * ===============================
 */

router.get("/products/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required"
      });
    }

    const xmlRequest = `
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

    const xmlResponse = await makeEBayAPICall(xmlRequest, "GetItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "GetItem");

    const item = response.Item;
    if (!item) {
      throw new Error(`Item ${itemId} not found`);
    }

    // Extract pricing strategy data from ItemSpecifics
    const itemSpecifics = item.ItemSpecifics?.NameValueList || [];
    
    // Check if any strategy-related specifics exist
    const specificsArray = Array.isArray(itemSpecifics) ? itemSpecifics : [itemSpecifics];
    const hasAnyStrategyData = specificsArray.some(spec => {
      if (!spec?.Name) return false;
      const name = spec.Name.toLowerCase();
      return name.includes('pricing') || 
             name.includes('strategy') || 
             name.includes('repricing') ||
             spec.Name === 'NoCompetitionAction' ||
             spec.Name === 'MaxPrice' || 
             spec.Name === 'MinPrice';
    });

    let pricingStrategy = null;
    let hasPricingStrategy = false;

    if (hasAnyStrategyData) {
      pricingStrategy = parsePricingStrategyFromSpecifics(itemSpecifics, itemId);
      hasPricingStrategy = pricingStrategy !== null;
      
      // If we get default values, it means parsing failed
      if (pricingStrategy && 
          pricingStrategy.strategyName === "Unnamed Strategy" && 
          pricingStrategy.repricingRule === "UNKNOWN") {
        
        console.log(`Warning: Found strategy data but parsing returned defaults for item ${itemId}`);
        
        // Optionally, still return the data but flag it as potentially incomplete
        pricingStrategy.warning = "Strategy data found but some fields could not be parsed correctly";
      }
    }

    res.json({
      success: true,
      itemId,
      itemTitle: item.Title,
      hasPricingStrategy,
      pricingStrategy,
      itemDetails: {
        currentPrice: item.StartPrice?.Value || item.StartPrice?.__value__ || 0,
        currency: item.StartPrice?.__attributes__?.currencyID || item.Currency || "USD",
        listingType: item.ListingType,
        condition: item.ConditionDisplayName
      },
      debug: {
        totalItemSpecifics: specificsArray.length,
        hasAnyStrategyData,
        strategyRelatedSpecificsCount: specificsArray.filter(spec => {
          if (!spec?.Name) return false;
          const name = spec.Name.toLowerCase();
          return name.includes('pricing') || 
                 name.includes('strategy') || 
                 name.includes('repricing') ||
                 spec.Name === 'NoCompetitionAction' ||
                 spec.Name === 'MaxPrice' || 
                 spec.Name === 'MinPrice';
        }).length
      }
    });

  } catch (error) {
    console.error("eBay Pricing Strategy Fetch Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * ===============================
 * 4. FETCH ALL ACTIVE LISTINGS WITH PRICING STRATEGIES
 * ===============================
 */

router.get("/active-listings", async (req, res) => {
  try {
    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required"
      });
    }

    // Get all active listings
    const getActiveListingsXML = `
      <?xml version="1.0" encoding="utf-8"?>
      <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <ActiveList>
          <Include>true</Include>
          <Pagination>
            <EntriesPerPage>200</EntriesPerPage>
            <PageNumber>1</PageNumber>
          </Pagination>
        </ActiveList>
        <DetailLevel>ReturnAll</DetailLevel>
      </GetMyeBaySellingRequest>
    `;

    const activeListingsResponse = await makeEBayAPICall(getActiveListingsXML, "GetMyeBaySelling");
    const activeListingsResult = await parseXMLResponse(activeListingsResponse);
    const activeListingsData = isEBayResponseSuccessful(activeListingsResult, "GetMyeBaySelling");

    const activeList = activeListingsData.ActiveList;
    if (!activeList || !activeList.ItemArray) {
      return res.json({
        success: true,
        message: "No active listings found",
        listings: []
      });
    }

    const items = Array.isArray(activeList.ItemArray.Item) 
      ? activeList.ItemArray.Item 
      : [activeList.ItemArray.Item];

    // For each item, extract basic info and check if it has pricing strategies
    const listingsWithStrategies = items.map(item => {
      const itemSpecifics = item.ItemSpecifics?.NameValueList || [];
      const pricingStrategy = parsePricingStrategyFromSpecifics(itemSpecifics, item.ItemID);

      return {
        itemId: item.ItemID,
        title: item.Title,
        currentPrice: item.StartPrice?.Value || item.StartPrice?.__value__ || 0,
        currency: item.StartPrice?.__attributes__?.currencyID || "USD",
        listingType: item.ListingType,
        hasPricingStrategy: pricingStrategy !== null,
        pricingStrategy
      };
    });

    const withStrategy = listingsWithStrategies.filter(item => item.hasPricingStrategy);
    const withoutStrategy = listingsWithStrategies.filter(item => !item.hasPricingStrategy);

    res.json({
      success: true,
      summary: {
        totalActiveListings: listingsWithStrategies.length,
        listingsWithStrategy: withStrategy.length,
        listingsWithoutStrategy: withoutStrategy.length
      },
      listings: listingsWithStrategies
    });

  } catch (error) {
    console.error("eBay Active Listings with Pricing Strategies Fetch Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * ===============================
 * 5. UPDATE PRICING STRATEGY ON SPECIFIC PRODUCT
 * ===============================
 */

router.put("/products/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const {
      strategyName,
      repricingRule,
      beatBy,
      stayAboveBy,
      value,
      noCompetitionAction = "USE_MAX_PRICE",
      maxPrice,
      minPrice
    } = req.body;

    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required"
      });
    }

    if (!strategyName || !repricingRule) {
      return res.status(400).json({
        success: false,
        message: "Strategy name and repricing rule are required"
      });
    }

    // Create updated pricing strategy specifics
    const strategySpecifics = createPricingStrategySpecifics(req.body);
    strategySpecifics.push({ name: "StrategyUpdatedAt", value: new Date().toISOString() });

    const xmlRequest = `
      <?xml version="1.0" encoding="utf-8"?>
      <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <Item>
          <ItemID>${itemId}</ItemID>
          <ItemSpecifics>
            ${strategySpecifics.map(spec => `
            <NameValueList>
              <n>${spec.name}</n>
              <Value>${spec.value}</Value>
            </NameValueList>
            `).join('')}
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "ReviseItem");

    res.json({
      success: true,
      message: "Pricing strategy updated successfully on eBay product",
      itemId,
      strategy: {
        name: strategyName,
        repricingRule,
        beatBy,
        stayAboveBy,
        value,
        noCompetitionAction,
        maxPrice,
        minPrice
      },
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime
      }
    });

  } catch (error) {
    console.error("eBay Pricing Strategy Update Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * ===============================
 * 6. DELETE PRICING STRATEGY FROM SPECIFIC PRODUCT
 * ===============================
 */

router.delete("/products/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required"
      });
    }

    // Add deletion markers to ItemSpecifics
    const xmlRequest = `
      <?xml version="1.0" encoding="utf-8"?>
      <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <Item>
          <ItemID>${itemId}</ItemID>
          <ItemSpecifics>
            <NameValueList>
              <n>StrategyDeleted</n>
              <Value>true</Value>
            </NameValueList>
            <NameValueList>
              <n>StrategyDeletedAt</n>
              <Value>${new Date().toISOString()}</Value>
            </NameValueList>
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "ReviseItem");

    res.json({
      success: true,
      message: "Pricing strategy deleted successfully from eBay product",
      itemId,
      deletedAt: new Date().toISOString(),
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime
      }
    });

  } catch (error) {
    console.error("eBay Pricing Strategy Deletion Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * ===============================
 * 7. DELETE PRICING STRATEGIES FROM ALL ACTIVE LISTINGS
 * ===============================
 */

router.delete("/delete-from-all-active", async (req, res) => {
  try {
    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required"
      });
    }

    // First get all active listings with pricing strategies
    const listingsResponse = await axios.get('/active-listings', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    const listingsWithStrategies = listingsResponse.data.listings.filter(item => item.hasPricingStrategy);

    if (listingsWithStrategies.length === 0) {
      return res.json({
        success: true,
        message: "No active listings with pricing strategies found",
        deletedCount: 0
      });
    }

    const results = [];
    const errors = [];

    // Delete pricing strategy from each listing
    for (const listing of listingsWithStrategies) {
      try {
        const xmlRequest = `
          <?xml version="1.0" encoding="utf-8"?>
          <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
            <RequesterCredentials>
              <eBayAuthToken>${authToken}</eBayAuthToken>
            </RequesterCredentials>
            <Item>
              <ItemID>${listing.itemId}</ItemID>
              <ItemSpecifics>
                <NameValueList>
                  <n>StrategyDeleted</n>
                  <Value>true</Value>
                </NameValueList>
                <NameValueList>
                  <n>StrategyDeletedAt</n>
                  <Value>${new Date().toISOString()}</Value>
                </NameValueList>
              </ItemSpecifics>
            </Item>
          </ReviseItemRequest>
        `;

        const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
        const result = await parseXMLResponse(xmlResponse);
        isEBayResponseSuccessful(result, "ReviseItem");

        results.push({
          itemId: listing.itemId,
          title: listing.title,
          success: true
        });

        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        errors.push({
          itemId: listing.itemId,
          title: listing.title,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Pricing strategy deletion processed for ${results.length} listings`,
      summary: {
        totalProcessed: listingsWithStrategies.length,
        successful: results.length,
        failed: errors.length
      },
      results,
      errors
    });

  } catch (error) {
    console.error("eBay Pricing Strategy Bulk Deletion Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * ===============================
 * 8. APPLY PRICING STRATEGY TO UPDATE PRODUCT PRICE
 * ===============================
 */

router.post("/products/:itemId/apply", async (req, res) => {
  try {
    const { itemId } = req.params;
    const { 
      competitorPrices = [], 
      useExistingStrategy = true,
      newPrice 
    } = req.body;

    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required"
      });
    }

    let priceToApply = newPrice;

    // If using existing strategy, fetch it first and calculate price
    if (useExistingStrategy && !newPrice) {
      // Fetch existing strategy from the product
      const strategyResponse = await axios.get(`/products/${itemId}`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });

      if (!strategyResponse.data.hasPricingStrategy) {
        return res.status(400).json({
          success: false,
          message: "No pricing strategy found on this product. Please create a strategy first or provide a newPrice."
        });
      }

      const strategy = strategyResponse.data.pricingStrategy;
      const currentPrice = strategyResponse.data.itemDetails.currentPrice;

      // Calculate new price based on strategy and competitor prices
      if (competitorPrices.length > 0) {
        const lowestCompetitorPrice = Math.min(...competitorPrices);

        switch (strategy.repricingRule) {
          case "MATCH_LOWEST":
            priceToApply = lowestCompetitorPrice;
            break;
          case "BEAT_LOWEST":
            if (strategy.beatBy === "AMOUNT") {
              priceToApply = lowestCompetitorPrice - (strategy.beatValue || 1);
            } else if (strategy.beatBy === "PERCENTAGE") {
              priceToApply = lowestCompetitorPrice * (1 - (strategy.beatValue || 0.05));
            }
            break;
          case "STAY_ABOVE":
            if (strategy.stayAboveBy === "AMOUNT") {
              priceToApply = lowestCompetitorPrice + (strategy.stayAboveValue || 1);
            } else if (strategy.stayAboveBy === "PERCENTAGE") {
              priceToApply = lowestCompetitorPrice * (1 + (strategy.stayAboveValue || 0.05));
            }
            break;
        }

        // Apply constraints
        if (strategy.minPrice && priceToApply < strategy.minPrice) {
          priceToApply = strategy.minPrice;
        }
        if (strategy.maxPrice && priceToApply > strategy.maxPrice) {
          priceToApply = strategy.maxPrice;
        }
      } else {
        return res.status(400).json({
          success: false,
          message: "Competitor prices are required when using existing strategy"
        });
      }
    }

    if (!priceToApply || priceToApply <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid price is required"
      });
    }

    // Apply the new price to eBay
    const xmlRequest = `
      <?xml version="1.0" encoding="utf-8"?>
      <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <Item>
          <ItemID>${itemId}</ItemID>
          <StartPrice currencyID="USD">${priceToApply.toFixed(2)}</StartPrice>
          <ItemSpecifics>
            <NameValueList>
              <n>LastPriceUpdate</n>
              <Value>${new Date().toISOString()}</Value>
            </NameValueList>
            <NameValueList>
              <n>PriceUpdateMethod</n>
              <Value>${useExistingStrategy ? 'STRATEGY_APPLIED' : 'MANUAL_OVERRIDE'}</Value>
            </NameValueList>
            <NameValueList>
              <n>CompetitorPricesUsed</n>
              <Value>${competitorPrices.length}</Value>
            </NameValueList>
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "ReviseItem");

    res.json({
      success: true,
      message: "Pricing strategy applied successfully - price updated on eBay",
      itemId,
      priceUpdate: {
        newPrice: priceToApply,
        appliedAt: new Date().toISOString(),
        competitorPricesUsed: competitorPrices.length,
        method: useExistingStrategy ? 'STRATEGY_APPLIED' : 'MANUAL_OVERRIDE'
      },
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime
      }
    });

  } catch (error) {
    console.error("eBay Pricing Strategy Application Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * ===============================
 * 9. APPLY PRICING STRATEGY TO MULTIPLE PRODUCTS (BULK APPLY)
 * ===============================
 */

router.post("/apply-bulk", async (req, res) => {
  try {
    const { 
      itemIds = [],
      competitorPricesByItem = {}, // { itemId: [prices...] }
      useExistingStrategy = true,
      applyToAllActive = false
    } = req.body;

    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required"
      });
    }

    let targetItems = [];

    if (applyToAllActive) {
      // Get all active listings with strategies
      const listingsResponse = await axios.get('/active-listings', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      targetItems = listingsResponse.data.listings
        .filter(item => item.hasPricingStrategy)
        .map(item => item.itemId);
    } else {
      targetItems = itemIds;
    }

    if (targetItems.length === 0) {
      return res.json({
        success: true,
        message: "No items to process",
        results: []
      });
    }

    const results = [];
    const errors = [];

    for (const itemId of targetItems) {
      try {
        const competitorPrices = competitorPricesByItem[itemId] || [];
        
        // Apply strategy to this item
        const applyResponse = await axios.post(`/products/${itemId}/apply`, {
          competitorPrices,
          useExistingStrategy
        }, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });

        results.push({
          itemId,
          success: true,
          ...applyResponse.data.priceUpdate
        });

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 150));

      } catch (error) {
        errors.push({
          itemId,
          success: false,
          error: error.response?.data?.message || error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Bulk strategy application completed for ${results.length} of ${targetItems.length} items`,
      summary: {
        totalItems: targetItems.length,
        successful: results.length,
        failed: errors.length
      },
      results,
      errors
    });

  } catch (error) {
    console.error("eBay Bulk Strategy Application Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


// Error handling middleware
router.use((err, req, res, next) => {
  console.error("API Error:", err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

export default router;




// ===============================
// DEBUGGING ENDPOINT (Add this to your backend for testing)
// ===============================

router.get("/debug/item-specifics/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required"
      });
    }

    const xmlRequest = `
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

    const xmlResponse = await makeEBayAPICall(xmlRequest, "GetItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "GetItem");

    const item = response.Item;
    if (!item) {
      throw new Error(`Item ${itemId} not found`);
    }

    // Return RAW ItemSpecifics for debugging
    const itemSpecifics = item.ItemSpecifics?.NameValueList || [];
    const specificsArray = Array.isArray(itemSpecifics) ? itemSpecifics : [itemSpecifics];

    res.json({
      success: true,
      itemId,
      itemTitle: item.Title,
      totalSpecifics: specificsArray.length,
      allItemSpecifics: specificsArray.map(spec => ({
        name: spec.Name,
        value: spec.Value
      })),
      strategyRelatedSpecifics: specificsArray.filter(spec => {
        const name = spec.Name?.toLowerCase() || '';
        return name.includes('pricing') || 
               name.includes('strategy') || 
               name.includes('repricing') ||
               name.includes('beat') || 
               name.includes('stay') ||
               name.includes('above') ||
               name.includes('below') ||
               name.includes('match') ||
               name.includes('lowest') ||
               spec.Name === 'NoCompetitionAction' ||
               spec.Name === 'MaxPrice' || 
               spec.Name === 'MinPrice';
      })
    });

  } catch (error) {
    console.error("Debug ItemSpecifics Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ===============================
// MANUAL STRATEGY CREATION FOR TESTING
// ===============================


router.post("/debug/create-test-strategy/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const authToken = process.env.AUTH_TOKEN;

    // Create a test strategy with known field names
    const testStrategySpecifics = [
      { name: "PricingStrategyName", value: "Test Strategy" },
      { name: "RepricingRule", value: "MATCH_LOWEST" },
      { name: "NoCompetitionAction", value: "USE_MAX_PRICE" },
      { name: "MaxPrice", value: "100.00" },
      { name: "MinPrice", value: "50.00" },
      { name: "StrategyCreatedAt", value: new Date().toISOString() }
    ];

    const xmlRequest = `
      <?xml version="1.0" encoding="utf-8"?>
      <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <Item>
          <ItemID>${itemId}</ItemID>
          <ItemSpecifics>
            ${testStrategySpecifics.map(spec => `
            <NameValueList>
              <n>${spec.name}</n>
              <Value>${spec.value}</Value>
            </NameValueList>
            `).join('')}
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "ReviseItem");

    res.json({
      success: true,
      message: "Test strategy created successfully",
      itemId,
      testStrategySpecifics,
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime
      }
    });

  } catch (error) {
    console.error("Create Test Strategy Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});
//  /strategies/match-lowest

// {
//   "strategyName": "Match Competitors Price",
//   "repricingRule": "MATCH_LOWEST",
//   "noCompetitionAction": "USE_MAX_PRICE",
//   "assignToActiveListings": false,
//   "maxPrice": 150.00,
//   "minPrice": 50.00,
//   "listings": ["314851424639", "314851424640"]
// }


// POST /strategies/beat-lowest
// {
//   "strategyName": "Beat by $5",
//   "repricingRule": "BEAT_LOWEST", 
//   "beatBy": "AMOUNT",
//   "value": 5.00,
//   "noCompetitionAction": "USE_MAX_PRICE",
//   "assignToActiveListings": true,
//   "maxPrice": 200.00,
//   "minPrice": 75.00,
//   "listings": []
// }

// POST /strategies/stay-above
// {
//   "strategyName": "Stay 15% Above",
//   "repricingRule": "STAY_ABOVE",
//   "stayAboveBy": "PERCENTAGE", 
//   "value": 0.15,
//   "noCompetitionAction": "USE_MAX_PRICE",
//   "assignToActiveListings": false,
//   "maxPrice": 300.00,
//   "minPrice": 90.00,
//   "listings": ["314851424639"]
// }


// Stay Above by Dollar Amount:
// {
//   "strategyName": "Stay $10 Above",
//   "repricingRule": "STAY_ABOVE",
//   "stayAboveBy": "AMOUNT",
//   "value": 10.00,
//   "noCompetitionAction": "USE_MAX_PRICE",
//   "assignToActiveListings": false,
//   "maxPrice": 250.00,
//   "minPrice": 80.00
// }


// /apply-strategy
// {
//   "strategyId": 1,
//   "items": [
//     {
//       "itemId": "314851424639",
//       "currentPrice": 84.5
//     },
//     {
//       "itemId": "314851424640", 
//       "currentPrice": 95.0
//     }
//   ],
//   "useProvidedPrices": false,
//   "competitorPrices": []
// }
