// services/inventoryService.js

import axios from 'axios';
import xml2js from 'xml2js';
import User from '../models/Users.js';

/**
 * Get competitor prices for a specific item
 * @param {String} itemId - The eBay item ID
 * @param {String} userId - The user ID (optional)
 */
export async function getCompetitorPrice(itemId, userId = null) {
  try {
    console.log(
      `[inventoryService] Getting competitor price for item: ${itemId}`
    );

    // For now, simulate competitor price data
    // In a real implementation, this would call your competitor price API
    const mockCompetitorData = {
      success: true,
      price: 'USD5.27',
      count: 13,
      allPrices: [5.27, 5.3, 5.35, 5.4, 5.45],
      productInfo: [],
    };

    console.log(
      `[inventoryService] Returning competitor data:`,
      mockCompetitorData
    );
    return mockCompetitorData;
  } catch (error) {
    console.error(
      `[inventoryService] Error getting competitor price for ${itemId}:`,
      error
    );
    return {
      success: false,
      price: 'USD0.00',
      count: 0,
      allPrices: [],
      productInfo: [],
      error: error.message,
    };
  }
}

/**
 * Get updated price for an item if it exists - simplified version
 */
function getUpdatedPrice(itemId, sku) {
  // For now, just return null since we're updating eBay directly
  // The frontend should get the latest price from eBay API calls
  console.log(
    `📊 Checking for updated price: ${itemId}:${sku} - relying on eBay API`
  );
  return null;
}

/**
 * Get active eBay listings using Trading API
 */
export async function getActiveListings(userId = null) {
  try {
    console.log(
      `[inventoryService] Getting REAL eBay listings from Trading API...`
    );

    // Get user token if userId provided
    let authToken = null;
    if (userId) {
      const user = await User.findById(userId);
      if (user && user.ebay.accessToken) {
        authToken = user.ebay.accessToken;
      }
    }

    if (!authToken) {
      // Use environment token as fallback
      authToken = process.env.EBAY_ACCESS_TOKEN;
    }

    if (!authToken) {
      throw new Error('No eBay access token available');
    }

    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log(
      `🔑 Using eBay token starting with: ${authToken.substring(0, 20)}...`
    );
    console.log(`🔑 Token length: ${authToken.length} characters`);

    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
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
</GetMyeBaySellingRequest>`;

    console.log(`📤 Sending request to eBay Trading API...`);

    const response = await axios({
      method: 'POST',
      url:
        process.env.NODE_ENV === 'production'
          ? 'https://api.ebay.com/ws/api.dll'
          : 'https://api.sandbox.ebay.com/ws/api.dll',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
        'X-EBAY-API-APP-NAME': process.env.CLIENT_ID,
      },
      data: xmlRequest,
    });

    const parser = new xml2js.Parser({
      explicitArray: false,
      ignoreAttrs: true,
    });

    const result = await new Promise((resolve, reject) => {
      parser.parseString(response.data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const ebayResponse = result.GetMyeBaySellingResponse;

    if (ebayResponse.Ack === 'Success' || ebayResponse.Ack === 'Warning') {
      console.log(`✅ eBay API success: ${ebayResponse.Ack}`);
      return {
        success: true,
        data: result,
      };
    } else {
      const errors = ebayResponse.Errors;
      console.error(`❌ eBay API returned error:`, errors);

      // FIX: Don't fall back to mock data, return actual error
      throw new Error(
        `eBay API Error: ${
          errors?.LongMessage || errors?.ShortMessage || 'Unknown error'
        }`
      );
    }
  } catch (error) {
    console.error(`❌ eBay API Error in getActiveListings:`, error.message);

    // FIX: Don't return mock data, throw the actual error
    throw new Error(`Failed to fetch eBay listings: ${error.message}`);
  }
}

/**
 * Update eBay listing price using Trading API directly
 * THIS IS ONLY CALLED BY STRATEGY SERVICE - NOT MANUAL EDITING
 */
export async function updateEbayPrice(itemId, sku, newPrice, userId = null) {
  try {
    console.log(
      `🤖 STRATEGY-DRIVEN price update: ${itemId}/${sku} to $${newPrice}`
    );

    // Debug environment settings
    console.log(`🌍 NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(
      `🌍 Environment check: ${
        process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'SANDBOX'
      }`
    );

    // Get user with eBay credentials
    let user = null;
    if (userId) {
      user = await User.findById(userId);
    }

    if (!user || !user.ebay?.accessToken) {
      user = await User.findOne({ 'ebay.accessToken': { $exists: true } });
    }

    if (!user || !user.ebay.accessToken) {
      console.log('🧪 No eBay credentials found, simulating update');
      return {
        success: true,
        itemId,
        newPrice,
        message: 'Price updated successfully (simulated - no eBay credentials)',
        simulated: true,
      };
    }

    const authToken = user.ebay.accessToken;

    // Add debugging for token
    console.log(
      `🔑 Using eBay token starting with: ${authToken.substring(0, 20)}...`
    );
    console.log(`🔑 Token length: ${authToken.length} characters`);

    // Use eBay ReviseInventoryStatus API directly
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <InventoryStatus>
    <ItemID>${itemId}</ItemID>
    <SKU>${sku}</SKU>
    <StartPrice>${newPrice}</StartPrice>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;

    console.log(
      `📤 Sending eBay API request for strategy update: ${itemId}/${sku}`
    );

    // FIXED: Use correct environment logic
    const ebayUrl =
      process.env.NODE_ENV === 'production'
        ? 'https://api.ebay.com/ws/api.dll' // PRODUCTION
        : 'https://api.sandbox.ebay.com/ws/api.dll'; // SANDBOX

    console.log(`🌍 Using eBay URL: ${ebayUrl}`);

    const response = await axios({
      method: 'POST',
      url: ebayUrl,
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-CALL-NAME': 'ReviseInventoryStatus',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
        'X-EBAY-API-APP-NAME': process.env.CLIENT_ID,
      },
      data: xmlRequest,
    });

    const parser = new xml2js.Parser({
      explicitArray: false,
      ignoreAttrs: true,
    });

    const result = await new Promise((resolve, reject) => {
      parser.parseString(response.data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const reviseResponse = result.ReviseInventoryStatusResponse;

    if (reviseResponse.Ack === 'Success' || reviseResponse.Ack === 'Warning') {
      console.log(
        `✅ STRATEGY successfully updated eBay price for ${itemId} to $${newPrice}`
      );

      // Log to price history with strategy context
      try {
        const PriceHistory = (await import('../models/PriceHistory.js'))
          .default;
        await new PriceHistory({
          itemId,
          sku,
          newPrice: parseFloat(newPrice),
          currency: 'USD',
          source: 'automated_strategy', // Mark as strategy-driven
          status: 'completed',
          success: true,
          userId: user._id,
          apiResponse: {
            ack: reviseResponse.Ack,
            timestamp: reviseResponse.Timestamp,
            inventoryStatus: reviseResponse.InventoryStatus,
          },
        }).save();
      } catch (historyError) {
        console.warn('Could not save price history:', historyError.message);
      }

      return {
        success: true,
        itemId,
        newPrice,
        message: 'Price updated successfully on eBay via strategy',
        ebayResponse: reviseResponse,
        timestamp: new Date(),
      };
    } else {
      console.error(
        `❌ eBay API returned error for ${itemId}:`,
        reviseResponse.Errors
      );

      console.log(`⚠️ eBay token issue - need to refresh authentication`);
      return {
        success: false,
        itemId,
        newPrice,
        message: 'eBay authentication token expired - please re-authenticate',
        error: 'Invalid eBay token',
        requiresReauth: true,
      };
    }
  } catch (error) {
    console.error(
      `❌ Error in strategy price update for ${itemId}:`,
      error.message
    );
    return {
      success: false,
      error: error.message,
      itemId,
      newPrice,
    };
  }
}

/**
 * Monitor and sync price changes based on strategies
 * @param {String} itemId - The item to monitor
 * @param {String} userId - User ID for eBay credentials
 */
export async function syncPriceWithStrategy(itemId, userId = null) {
  try {
    console.log(
      `🔄 Syncing price for item ${itemId} with applied strategies...`
    );

    // Import strategy service to execute pricing logic
    const { executeStrategiesForItem } = await import('./strategyService.js');

    const result = await executeStrategiesForItem(itemId);

    if (result.success) {
      console.log(`✅ Price sync completed for ${itemId}`);
      return result;
    } else {
      console.log(`⚠️ Price sync failed for ${itemId}:`, result.message);
      return result;
    }
  } catch (error) {
    console.error(`❌ Error syncing price for ${itemId}:`, error);
    return {
      success: false,
      error: error.message,
      itemId,
    };
  }
}

/**
 * Get current price of an item from eBay
 * @param {String} itemId - The eBay item ID
 * @param {String} sku - The item SKU
 * @param {String} userId - User ID for eBay credentials
 */
export async function getCurrentEbayPrice(itemId, sku = null, userId = null) {
  try {
    console.log(
      `💰 Getting current eBay price for ${itemId}${sku ? `/${sku}` : ''}`
    );

    const listings = await getActiveListings(userId);

    if (listings.success && listings.data.GetMyeBaySellingResponse) {
      const itemArray =
        listings.data.GetMyeBaySellingResponse.ActiveList?.ItemArray;
      let items = [];

      if (Array.isArray(itemArray?.Item)) {
        items = itemArray.Item;
      } else if (itemArray?.Item) {
        items = [itemArray.Item];
      }

      const item = items.find((i) => i.ItemID === itemId);

      if (item && item.BuyItNowPrice) {
        const currentPrice = parseFloat(item.BuyItNowPrice);
        console.log(`💰 Current eBay price for ${itemId}: $${currentPrice}`);
        return {
          success: true,
          price: currentPrice,
          itemId,
          sku: item.SKU || sku,
        };
      }
    }

    console.log(`⚠️ Could not get current price for item ${itemId}`);
    return {
      success: false,
      error: 'Item not found or no price available',
      itemId,
      sku,
    };
  } catch (error) {
    console.error(`❌ Error getting current eBay price for ${itemId}:`, error);
    return {
      success: false,
      error: error.message,
      itemId,
      sku,
    };
  }
}
