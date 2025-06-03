import express from "express";
import axios from "axios";
import xml2js from "xml2js";

const router = express.Router();

// Simple in-memory cache with expiration
const cache = {
  items: {},
  set: function(key, value, ttlSeconds = 3600) { // Default TTL: 1 hour
    this.items[key] = {
      value,
      expiry: Date.now() + (ttlSeconds * 1000)
    };
  },
  get: function(key) {
    const item = this.items[key];
    if (!item) return null;
    if (Date.now() > item.expiry) {
      delete this.items[key];
      return null;
    }
    return item.value;
  }
};

/**
 * Fetch price history directly from eBay using RevisionHistory
 */
router.get("/history/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    
    // Try to get from cache first
    const cachedHistory = cache.get(`history_${itemId}`);
    if (cachedHistory) {
      console.log(`Returning cached price history for item ${itemId}`);
      return res.json(cachedHistory);
    }
    
    // Fetch revision history from eBay
    const priceHistory = await fetchPriceHistoryFromEbay(itemId);
    
    if (!priceHistory) {
      return res.status(404).json({ 
        success: false, 
        message: "Could not retrieve price history from eBay" 
      });
    }
    
    // Cache the result for 30 minutes
    cache.set(`history_${itemId}`, priceHistory, 1800);
    
    return res.json(priceHistory);
  } catch (error) {
    console.error("Error fetching price history:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching price history",
      error: error.message
    });
  }
});

/**
 * Fetch an item's complete price history from eBay
 */
async function fetchPriceHistoryFromEbay(itemId) {
  try {
    // First get item details with revision history
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
    <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <RequesterCredentials>
        <eBayAuthToken>${process.env.AUTH_TOKEN}</eBayAuthToken>
      </RequesterCredentials>
      <ItemID>${itemId}</ItemID>
      <DetailLevel>ReturnAll</DetailLevel>
      <IncludeItemSpecifics>true</IncludeItemSpecifics>
      <IncludeWatchCount>true</IncludeWatchCount>
      <IncludeRevisionHistory>true</IncludeRevisionHistory>
    </GetItemRequest>`;

    const response = await axios.post("https://api.ebay.com/ws/api.dll", xmlRequest, {
      headers: {
        "X-EBAY-API-CALL-NAME": "GetItem",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-APP-NAME": process.env.CLIENT_ID,
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "Content-Type": "text/xml",
      },
    });

    const result = await xml2js.parseStringPromise(response.data, { explicitArray: false });
    
    if (!result.GetItemResponse || !result.GetItemResponse.Item) {
      throw new Error("Invalid response from eBay API");
    }
    
    const item = result.GetItemResponse.Item;
    
    // Get current price and item details
    const currentPrice = parseFloat(item.SellingStatus.CurrentPrice._);
    const currencyCode = item.SellingStatus.CurrentPrice.$.currencyID;
    const title = item.Title;
    const sku = item.SKU || null;
    
    // Process price revisions
    const priceChanges = [];
    let lastPrice = null;
    
    // Format creation date as first price
    const creationDate = item.ListingDetails?.StartTime || new Date().toISOString();
    
    // If revision history exists, process it
    if (item.RevisionHistory && item.RevisionHistory.RevisionArray) {
      // Convert to array if it's not already
      const revisions = Array.isArray(item.RevisionHistory.RevisionArray.Revision) 
        ? item.RevisionHistory.RevisionArray.Revision 
        : [item.RevisionHistory.RevisionArray.Revision];
      
      // Sort revisions chronologically
      revisions.sort((a, b) => new Date(a.RevisionTime) - new Date(b.RevisionTime));
      
      // Track price changes across revisions
      for (const revision of revisions) {
        // Check if this revision contains a price change
        if (revision.ItemRevisionDetails && 
            (revision.ItemRevisionDetails.StartPrice || 
             revision.ItemRevisionDetails.CurrentPrice)) {
          
          // Get the new price from the revision
          const newPrice = parseFloat(
            revision.ItemRevisionDetails.StartPrice?.value || 
            revision.ItemRevisionDetails.StartPrice || 
            revision.ItemRevisionDetails.CurrentPrice?.value ||
            revision.ItemRevisionDetails.CurrentPrice || 
            currentPrice
          );
          
          // Only record if price actually changed
          if (lastPrice === null || Math.abs(newPrice - lastPrice) > 0.001) {
            // Calculate change metrics
            const changeAmount = lastPrice !== null ? newPrice - lastPrice : 0;
            const changePercent = lastPrice !== null && lastPrice !== 0 ? 
                                ((newPrice - lastPrice) / lastPrice * 100).toFixed(2) : 0;
            
            // Record the price change
            priceChanges.push({
              oldPrice: lastPrice,
              newPrice: newPrice,
              timestamp: new Date(revision.RevisionTime),
              changeAmount,
              changePercent,
              revisionId: revision.RevisionNumber
            });
            
            lastPrice = newPrice;
          }
        }
      }
    }
    
    // If no price changes found in revision history, add the initial listing price
    if (priceChanges.length === 0) {
      priceChanges.push({
        oldPrice: null,
        newPrice: currentPrice,
        timestamp: new Date(creationDate),
        changeAmount: 0,
        changePercent: 0,
        revisionId: "initial"
      });
    }
    
    // Format the price history response
    return {
      success: true,
      itemId,
      title,
      sku,
      currentPrice,
      currency: currencyCode,
      priceChanges,
      summary: {
        totalChanges: priceChanges.length,
        initialPrice: priceChanges[0].newPrice,
        currentPrice: currentPrice,
        totalChangeAmount: currentPrice - priceChanges[0].newPrice,
        totalChangePercent: priceChanges[0].newPrice > 0 ? 
          ((currentPrice - priceChanges[0].newPrice) / priceChanges[0].newPrice * 100).toFixed(2) : 0,
        firstRevisionDate: priceChanges[0].timestamp,
        lastRevisionDate: priceChanges[priceChanges.length - 1].timestamp
      }
    };
  } catch (error) {
    console.error(`Error fetching price history for item ${itemId}:`, error.message);
    return null;
  }
}

/**
 * Record a price change from our application
 * This doesn't store in a database but can trigger price update on eBay
 */
router.post("/record-price-change", async (req, res) => {
  try {
    const { itemId, newPrice, reason } = req.body;
    
    if (!itemId || newPrice === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing required fields (itemId, newPrice)" 
      });
    }
    
    // Get current price from eBay first
    const currentItemInfo = await fetchCurrentItemInfo(itemId);
    
    if (!currentItemInfo) {
      return res.status(404).json({
        success: false,
        message: "Could not retrieve current item information"
      });
    }
    
    const oldPrice = currentItemInfo.currentPrice;
    
    // Only proceed if the price is actually changing
    if (Math.abs(oldPrice - newPrice) <= 0.001) {
      return res.json({
        success: true,
        message: "No price change needed - new price matches current price",
        itemId,
        oldPrice,
        newPrice
      });
    }
    
    // Revise the item on eBay with the new price
    const updateResult = await updateItemPrice(itemId, newPrice);
    
    if (!updateResult.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to update price on eBay",
        error: updateResult.error
      });
    }
    
    // Clear cache for this item
    cache.items[`history_${itemId}`] = null;
    
    // Return success response
    return res.json({
      success: true,
      message: "Price updated successfully",
      itemId,
      oldPrice,
      newPrice,
      changeAmount: newPrice - oldPrice,
      changePercent: oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice * 100).toFixed(2) : 0,
      timestamp: new Date(),
      reason
    });
    
  } catch (error) {
    console.error("Error recording price change:", error);
    return res.status(500).json({
      success: false,
      message: "Error recording price change",
      error: error.message
    });
  }
});

/**
 * Fetch current price and basic info for an item
 */
async function fetchCurrentItemInfo(itemId) {
  try {
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
    <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <RequesterCredentials>
        <eBayAuthToken>${process.env.AUTH_TOKEN}</eBayAuthToken>
      </RequesterCredentials>
      <ItemID>${itemId}</ItemID>
      <DetailLevel>ReturnAll</DetailLevel>
      <OutputSelector>ItemID</OutputSelector>
      <OutputSelector>Title</OutputSelector>
      <OutputSelector>SellingStatus</OutputSelector>
      <OutputSelector>SKU</OutputSelector>
    </GetItemRequest>`;

    const response = await axios.post("https://api.ebay.com/ws/api.dll", xmlRequest, {
      headers: {
        "X-EBAY-API-CALL-NAME": "GetItem",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-APP-NAME": process.env.CLIENT_ID,
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "Content-Type": "text/xml",
      },
    });

    const result = await xml2js.parseStringPromise(response.data, { explicitArray: false });
    const item = result.GetItemResponse.Item;
    
    if (!item) throw new Error("Item not found in response");

    return { 
      currentPrice: parseFloat(item.SellingStatus.CurrentPrice._),
      currencyCode: item.SellingStatus.CurrentPrice.$.currencyID,
      title: item.Title,
      sku: item.SKU || null
    };
  } catch (error) {
    console.error(`Error fetching current price for item ${itemId}:`, error.message);
    return null;
  }
}

/**
 * Update an item's price on eBay
 */
async function updateItemPrice(itemId, newPrice) {
  try {
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
    <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <RequesterCredentials>
        <eBayAuthToken>${process.env.AUTH_TOKEN}</eBayAuthToken>
      </RequesterCredentials>
      <Item>
        <ItemID>${itemId}</ItemID>
        <StartPrice>${newPrice}</StartPrice>
      </Item>
    </ReviseItemRequest>`;

    const response = await axios.post("https://api.ebay.com/ws/api.dll", xmlRequest, {
      headers: {
        "X-EBAY-API-CALL-NAME": "ReviseItem",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-APP-NAME": process.env.CLIENT_ID,
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "Content-Type": "text/xml",
      },
    });

    const result = await xml2js.parseStringPromise(response.data, { explicitArray: false });
    
    if (result.ReviseItemResponse && result.ReviseItemResponse.Ack === "Success") {
      return {
        success: true,
        itemId: result.ReviseItemResponse.ItemID
      };
    } else {
      const errorMessage = result.ReviseItemResponse?.Errors?.LongMessage || 
                          "Unknown error updating price";
      return {
        success: false,
        error: errorMessage
      };
    }
  } catch (error) {
    console.error(`Error updating price for item ${itemId}:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get a quick overview of all items and their current prices
 * This is a lightweight alternative to retrieving full history
 */
router.get("/current-prices", async (req, res) => {
  try {
    const { itemIds } = req.query;
    
    if (!itemIds) {
      return res.status(400).json({
        success: false,
        message: "Please provide comma-separated itemIds"
      });
    }
    
    const itemIdArray = itemIds.split(',').map(id => id.trim());
    const results = [];
    
    for (const itemId of itemIdArray) {
      const itemInfo = await fetchCurrentItemInfo(itemId);
      
      if (itemInfo) {
        results.push({
          itemId,
          title: itemInfo.title,
          currentPrice: itemInfo.currentPrice,
          currency: itemInfo.currencyCode,
          sku: itemInfo.sku
        });
      } else {
        results.push({
          itemId,
          error: "Could not retrieve item information"
        });
      }
    }
    
    return res.json({
      success: true,
      items: results,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error("Error fetching current prices:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching current prices",
      error: error.message
    });
  }
});

/**
 * Compare old and new prices for multiple items
 */
router.post("/compare-prices", async (req, res) => {
  try {
    const { items } = req.body;
    
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of items to compare"
      });
    }
    
    const results = [];
    
    for (const item of items) {
      if (!item.itemId) {
        results.push({
          error: "Missing itemId"
        });
        continue;
      }
      
      const currentInfo = await fetchCurrentItemInfo(item.itemId);
      
      if (!currentInfo) {
        results.push({
          itemId: item.itemId,
          error: "Could not retrieve current item information"
        });
        continue;
      }
      
      results.push({
        itemId: item.itemId,
        title: currentInfo.title,
        oldPrice: item.oldPrice || null,
        currentPrice: currentInfo.currentPrice,
        changeAmount: item.oldPrice ? currentInfo.currentPrice - item.oldPrice : null,
        changePercent: item.oldPrice ? 
          ((currentInfo.currentPrice - item.oldPrice) / item.oldPrice * 100).toFixed(2) : null,
        currency: currentInfo.currencyCode,
        sku: currentInfo.sku
      });
    }
    
    return res.json({
      success: true,
      items: results,
      timestamp: new Date()
    });
    
  } catch (error) {
    console.error("Error comparing prices:", error);
    return res.status(500).json({
      success: false,
      message: "Error comparing prices",
      error: error.message
    });
  }
});

export default router;