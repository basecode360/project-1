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
          price: item.price?.value || 0,
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
        message: "eBay auth token is required",
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
    const specificsArray = Array.isArray(itemSpecifics)
      ? itemSpecifics
      : [itemSpecifics];

    res.json({
      success: true,
      itemId,
      itemTitle: item.Title,
      totalSpecifics: specificsArray.length,
      allItemSpecifics: specificsArray.map((spec) => ({
        name: spec.Name,
        value: spec.Value,
      })),
      strategyRelatedSpecifics: specificsArray.filter((spec) => {
        const name = spec.Name?.toLowerCase() || "";
        return (
          name.includes("pricing") ||
          name.includes("strategy") ||
          name.includes("repricing") ||
          name.includes("beat") ||
          name.includes("stay") ||
          name.includes("above") ||
          name.includes("below") ||
          name.includes("match") ||
          name.includes("lowest") ||
          spec.Name === "NoCompetitionAction" ||
          spec.Name === "MaxPrice" ||
          spec.Name === "MinPrice"
        );
      }),
    });
  } catch (error) {
    console.error("Debug ItemSpecifics Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
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
