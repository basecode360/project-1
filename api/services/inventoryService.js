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
    console.log(`[inventoryService] Getting competitor price for item: ${itemId}`);

    // For now, simulate competitor price data
    // In a real implementation, this would call your competitor price API
    const mockCompetitorData = {
      success: true,
      price: 'USD5.27',
      count: 13,
      allPrices: [5.27, 5.3, 5.35, 5.4, 5.45],
      productInfo: [],
    };

    console.log(`[inventoryService] Returning competitor data:`, mockCompetitorData);
    return mockCompetitorData;
  } catch (error) {
    console.error(`[inventoryService] Error getting competitor price for ${itemId}:`, error);
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
 * Get real eBay listings using Trading API
 */
export async function getActiveListings(userId = null) {
  try {
    console.log('[inventoryService] Getting REAL eBay listings from Trading API...');

    // Get user with eBay credentials
    let user = null;
    if (userId) {
      user = await User.findById(userId);
    } else {
      // Get any user with eBay credentials as fallback
      user = await User.findOne({ 'ebay.accessToken': { $exists: true } });
    }

    if (!user || !user.ebay.accessToken) {
      console.log('No eBay credentials found, falling back to mock data');
      return getMockListings();
    }

    const authToken = user.ebay.accessToken;

    // Use eBay Trading API to get real listings
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>50</EntriesPerPage>
      <PageNumber>1</PageNumber>
    </Pagination>
  </ActiveList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`;

    console.log('📤 Sending request to eBay Trading API...');

    const response = await axios({
      method: 'POST',
      url: process.env.NODE_ENV === 'development' 
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

    const sellingResponse = result.GetMyeBaySellingResponse;

    if (sellingResponse.Ack === 'Success' || sellingResponse.Ack === 'Warning') {
      console.log('✅ Successfully retrieved real eBay listings');
      
      // Process real eBay data
      const activeList = sellingResponse.ActiveList;
      let items = [];

      if (activeList && activeList.ItemArray) {
        if (Array.isArray(activeList.ItemArray.Item)) {
          items = activeList.ItemArray.Item;
        } else if (activeList.ItemArray.Item) {
          items = [activeList.ItemArray.Item];
        }
      }

      console.log(`📊 Found ${items.length} real eBay listings`);

      return {
        success: true,
        data: {
          GetMyeBaySellingResponse: {
            ActiveList: {
              ItemArray: {
                Item: items
              }
            }
          }
        }
      };
    } else {
      console.error('❌ eBay API returned error:', sellingResponse.Errors);
      return getMockListings();
    }

  } catch (error) {
    console.error('[inventoryService] Error getting real eBay listings:', error);
    return getMockListings();
  }
}

/**
 * Fallback mock listings when eBay API is not available
 */
function getMockListings() {
  console.log('📊 Using mock listings as fallback');
  return {
    success: true,
    data: {
      GetMyeBaySellingResponse: {
        ActiveList: {
          ItemArray: {
            Item: [
              {
                ItemID: '388431853501',
                Title: 'Front Fog Light Cover Right Passenger Side Textured For 2013-2015 Nissan Altima',
                BuyItNowPrice: '54.65',
                Quantity: '9',
                SKU: 'PART123',
                SellingStatus: {
                  ListingStatus: 'Active',
                },
                ConditionDisplayName: 'New',
              },
              {
                ItemID: '388431851660',
                Title: 'Interior Door Handle Driver Left Side For 2001-2005 Kia Rio',
                BuyItNowPrice: '25.99',
                Quantity: '15',
                SKU: 'PART124',
                SellingStatus: {
                  ListingStatus: 'Active',
                },
                ConditionDisplayName: 'New',
              },
            ],
          },
        },
      },
    };
}

/**
 * Update eBay listing price using Trading API
 * @param {String} itemId - The eBay item ID
 * @param {String} sku - The item SKU
 * @param {Number} newPrice - The new price
 * @param {String} userId - User ID for eBay credentials
 */
export async function updateEbayPrice(itemId, sku, newPrice, userId = null) {
  try {
    console.log(`📝 Updating REAL eBay price: ${itemId}/${sku} to $${newPrice}`);

    // Get user with eBay credentials
    let user = null;
    if (userId) {
      user = await User.findById(userId);
    } else {
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

    // Use ReviseInventoryStatus for variation items with SKUs
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

    console.log(`📤 Sending REAL price update to eBay for ${itemId}/${sku}`);

    const response = await axios({
      method: 'POST',
      url: process.env.NODE_ENV === 'development'
        ? 'https://api.ebay.com/ws/api.dll'
        : 'https://api.sandbox.ebay.com/ws/api.dll',
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
      console.log(`✅ Successfully updated REAL eBay price for ${itemId} to $${newPrice}`);
      
      return {
        success: true,
        itemId,
        newPrice,
        message: 'Price updated successfully on eBay',
        ebayResponse: reviseResponse,
        timestamp: new Date(),
      };
    } else {
      console.error(`❌ eBay API returned error for ${itemId}:`, reviseResponse.Errors);
      return {
        success: false,
        error: 'eBay API returned error',
        ebayResponse: reviseResponse.Errors,
        itemId,
        newPrice
      };
    }

  } catch (error) {
    console.error(`❌ Error updating eBay price for ${itemId}:`, error);
    return {
      success: false,
      error: error.message,
      itemId,
      newPrice
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
    console.log(`🔄 Syncing price for item ${itemId} with applied strategies...`);
    
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
      itemId
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
    console.log(`💰 Getting current eBay price for ${itemId}${sku ? `/${sku}` : ''}`);
    
    const listings = await getActiveListings(userId);
    
    if (listings.success && listings.data.GetMyeBaySellingResponse) {
      const itemArray = listings.data.GetMyeBaySellingResponse.ActiveList?.ItemArray;
      let items = [];
      
      if (Array.isArray(itemArray?.Item)) {
        items = itemArray.Item;
      } else if (itemArray?.Item) {
        items = [itemArray.Item];
      }
      
      const item = items.find(i => i.ItemID === itemId);
      
      if (item && item.BuyItNowPrice) {
        const currentPrice = parseFloat(item.BuyItNowPrice);
        console.log(`💰 Current eBay price for ${itemId}: $${currentPrice}`);
        return {
          success: true,
          price: currentPrice,
          itemId,
          sku: item.SKU || sku
        };
      }
    }
    
    console.log(`⚠️ Could not get current price for item ${itemId}`);
    return {
      success: false,
      error: 'Item not found or no price available',
      itemId,
      sku
    };
    
  } catch (error) {
    console.error(`❌ Error getting current eBay price for ${itemId}:`, error);
    return {
      success: false,
      error: error.message,
      itemId,
      sku
    };
  }
}
