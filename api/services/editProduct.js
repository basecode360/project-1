import axios from 'axios';
import xml2js from 'xml2js';
import mongoose from 'mongoose'; // Add this import
import PriceHistory from '../models/PriceHistory.js';
import User from '../models/Users.js';

// Get item variations to find available SK
// Us
const getItemVariations = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in query parameters',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    const authToken = user.ebay.accessToken;
    console.log(`item id = > ${itemId}`);
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <ItemID>${itemId}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeVariations>true</IncludeVariations>
</GetItemRequest>`;

    const response = await axios({
      method: 'POST',
      // CORRECTED: Use production when NODE_ENV is production
      url:
        process.env.NODE_ENV === 'production'
          ? 'https://api.ebay.com/ws/api.dll' // PRODUCTION
          : 'https://api.sandbox.ebay.com/ws/api.dll', // SANDBOX
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-CALL-NAME': 'GetItem',
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

    const getItemResponse = result.GetItemResponse;

    if (getItemResponse.Ack === 'Success') {
      const item = getItemResponse.Item;
      const variations = item.Variations?.Variation || [];

      // Extract variation info
      const variationInfo = Array.isArray(variations)
        ? variations.map((variation) => ({
            sku: variation.SKU,
            startPrice: variation.StartPrice,
            quantity: variation.Quantity,
            variationSpecifics:
              variation.VariationSpecifics?.NameValueList || [],
          }))
        : [
            {
              sku: variations.SKU,
              startPrice: variations.StartPrice,
              quantity: variations.Quantity,
              variationSpecifics:
                variations.VariationSpecifics?.NameValueList || [],
            },
          ];

      return res.status(200).json({
        success: true,
        message: 'Item variations retrieved successfully',
        data: {
          itemId: item.ItemID,
          title: item.Title,
          hasVariations: !!item.Variations,
          variations: variationInfo,
        },
      });
    } else {
      throw new Error(JSON.stringify(getItemResponse.Errors));
    }
  } catch (error) {
    console.error('Error getting item variations:', error);
    return res.status(500).json({
      success: false,
      message: 'Error getting item variations',
      error: error.message,
    });
  }
};

const editVariationPrice = async (req, res) => {
  try {
    const {
      itemId,
      price,
      sku,
      currency = 'USD',
      title = null,
      userId = null,
    } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in request body',
      });
    }

    if (!itemId || !price || !sku) {
      return res.status(400).json({
        success: false,
        message:
          'Required fields are missing (itemId, price, and sku required)',
      });
    }

    // Use the direct eBay API update function
    const { updateEbayPrice } = await import('./inventoryService.js');
    const result = await updateEbayPrice(itemId, sku, price, userId);

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: `Price updated successfully to ${price} ${currency} for SKU: ${sku}`,
        data: {
          itemId,
          sku,
          startPrice: price,
          timestamp: result.timestamp,
          simulated: result.simulated || false,
        },
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Error updating variation price',
        error: result.error,
      });
    }
  } catch (error) {
    console.error('❌ Error updating variation price:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error updating variation price',
      error: error.message,
    });
  }
};

const editAllVariationsPrices = async (req, res) => {
  try {
    const { itemId, price, currency = 'USD', userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in request body',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    if (!itemId || !price) {
      return res.status(400).json({
        success: false,
        message: 'Required fields are missing (itemId and price required)',
      });
    }

    // First get all variations
    const authToken = user.ebay.accessToken;

    // Get item variations
    const getItemXml = `<?xml version="1.0" encoding="utf-8"?>
      <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <ItemID>${itemId}</ItemID>
        <IncludeVariations>true</IncludeVariations>
      </GetItemRequest>`;

    const getResponse = await axios({
      method: 'POST',
      url:
        process.env.NODE_ENV === 'development'
          ? 'https://api.ebay.com/ws/api.dll'
          : 'https://api.sandbox.ebay.com/ws/api.dll',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-CALL-NAME': 'GetItem',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
        'X-EBAY-API-APP-NAME': process.env.CLIENT_ID,
      },
      data: getItemXml,
    });

    const parser = new xml2js.Parser({
      explicitArray: false,
      ignoreAttrs: true,
    });
    const getResult = await new Promise((resolve, reject) => {
      parser.parseString(getResponse.data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const item = getResult.GetItemResponse.Item;
    const variations = item.Variations?.Variation || [];
    const variationList = Array.isArray(variations) ? variations : [variations];

    // Update each variation with delay to avoid rate limiting
    const updateResults = [];

    for (let i = 0; i < variationList.length; i++) {
      const variation = variationList[i];
      const sku = variation.SKU;

      // Add delay between requests to avoid rate limiting (except for first request)
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
      }

      // Fresh auth token for each request
      const currentAuthToken = user.ebay.accessToken;

      const updateXml = `<?xml version="1.0" encoding="utf-8"?>
        <ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
          <RequesterCredentials>
            <eBayAuthToken>${currentAuthToken}</eBayAuthToken>
          </RequesterCredentials>
          <InventoryStatus>
            <ItemID>${itemId}</ItemID>
            <SKU>${sku}</SKU>
            <StartPrice>${price}</StartPrice>
          </InventoryStatus>
        </ReviseInventoryStatusRequest>`;

      try {
        console.log(
          `Updating variation ${i + 1}/${variationList.length}: SKU ${sku}`
        );

        const updateResponse = await axios({
          method: 'POST',
          // CORRECTED: Use production when NODE_ENV is production
          url:
            process.env.NODE_ENV === 'production'
              ? 'https://api.ebay.com/ws/api.dll' // PRODUCTION
              : 'https://api.sandbox.ebay.com/ws/api.dll', // SANDBOX
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'X-EBAY-API-CALL-NAME': 'ReviseInventoryStatus',
            'X-EBAY-API-SITEID': '0',
            'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
            'X-EBAY-API-APP-NAME': process.env.CLIENT_ID,
            'User-Agent': 'Mozilla/5.0 (compatible; eBay-API-Client)',
            Connection: 'keep-alive',
          },
          data: updateXml,
          timeout: 30000,
        });

        const updateResult = await new Promise((resolve, reject) => {
          parser.parseString(updateResponse.data, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        const isSuccess =
          updateResult.ReviseInventoryStatusResponse.Ack === 'Success' ||
          updateResult.ReviseInventoryStatusResponse.Ack === 'Warning';

        updateResults.push({
          sku: sku,
          success: isSuccess,
          response: updateResult.ReviseInventoryStatusResponse,
        });

        console.log(`SKU ${sku} update: ${isSuccess ? 'SUCCESS' : 'FAILED'}`);
      } catch (error) {
        console.error(`Error updating SKU ${sku}:`, error.message);
        updateResults.push({
          sku: sku,
          success: false,
          error: error.message,
          details: error.response?.data || null,
        });
      }
    }

    const successCount = updateResults.filter((r) => r.success).length;
    const totalCount = updateResults.length;

    return res.status(200).json({
      success: successCount > 0,
      message: `Updated ${successCount}/${totalCount} variations to ${price} ${currency}`,
      data: {
        itemId,
        price,
        currency,
        totalVariations: totalCount,
        successfulUpdates: successCount,
        results: updateResults,
      },
    });
  } catch (error) {
    console.error('Error updating all variations:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating all variations',
      error: error.message,
    });
  }
};

// NEW: Strategy-driven price update function
const updatePriceViaStrategy = async (itemId, strategyData, userId) => {
  try {
    console.log(`🤖 STRATEGY-DRIVEN price update for ${itemId}:`, strategyData);

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      throw new Error('No eBay credentials found for this user');
    }

    // Get competitor price (this will be "Competition Lowest Price")
    const { getCompetitorPrice } = await import('./inventoryService.js');
    const competitorData = await getCompetitorPrice(itemId, userId);

    let competitorLowestPrice = 0;
    if (
      competitorData.success &&
      competitorData.allPrices &&
      competitorData.allPrices.length > 0
    ) {
      competitorLowestPrice = Math.min(...competitorData.allPrices);
      console.log(
        `📊 Competitor lowest price found: $${competitorLowestPrice}`
      );
    } else {
      console.log('⚠️ No competitor prices found, using fallback logic');
      competitorLowestPrice = 5.27; // Fallback price
    }

    // Get current eBay price (this will be "Old Price" = My Landed Price before change)
    let myLandedPriceBefore = null;
    try {
      const { getActiveListings } = await import('./inventoryService.js');
      const listingsResponse = await getActiveListings(userId);
      if (
        listingsResponse.success &&
        listingsResponse.data.GetMyeBaySellingResponse
      ) {
        const itemArray =
          listingsResponse.data.GetMyeBaySellingResponse.ActiveList?.ItemArray;
        let items = [];

        if (Array.isArray(itemArray?.Item)) {
          items = itemArray.Item;
        } else if (itemArray?.Item) {
          items = [itemArray.Item];
        }

        const currentItem = items.find((item) => item.ItemID === itemId);
        if (currentItem && currentItem.BuyItNowPrice) {
          myLandedPriceBefore = parseFloat(currentItem.BuyItNowPrice);
          console.log(
            `📊 My Landed Price (before change) for ${itemId}: $${myLandedPriceBefore}`
          );
        }
      }
    } catch (priceError) {
      console.warn(
        'Could not get current eBay price for history:',
        priceError.message
      );
    }

    // Calculate new price based on strategy (this will be "Sent Price")
    let newPriceFromStrategy = competitorLowestPrice;

    switch (strategyData.repricingRule) {
      case 'MATCH_LOWEST':
        newPriceFromStrategy = competitorLowestPrice;
        console.log(`🧮 MATCH_LOWEST: $${newPriceFromStrategy.toFixed(2)}`);
        break;
      case 'BEAT_LOWEST':
        if (strategyData.beatBy === 'AMOUNT') {
          newPriceFromStrategy =
            competitorLowestPrice - (strategyData.value || 0.1);
          console.log(
            `🧮 BEAT_LOWEST by AMOUNT: $${competitorLowestPrice} - $${
              strategyData.value
            } = $${newPriceFromStrategy.toFixed(2)}`
          );
        } else if (strategyData.beatBy === 'PERCENTAGE') {
          newPriceFromStrategy =
            competitorLowestPrice * (1 - (strategyData.value || 0.01));
          console.log(
            `🧮 BEAT_LOWEST by PERCENTAGE: $${competitorLowestPrice} * (1 - ${
              strategyData.value
            }) = $${newPriceFromStrategy.toFixed(2)}`
          );
        }
        break;
      case 'STAY_ABOVE':
        if (strategyData.stayAboveBy === 'AMOUNT') {
          newPriceFromStrategy =
            competitorLowestPrice + (strategyData.value || 0.1);
          console.log(
            `🧮 STAY_ABOVE by AMOUNT: $${competitorLowestPrice} + $${
              strategyData.value
            } = $${newPriceFromStrategy.toFixed(2)}`
          );
        } else if (strategyData.stayAboveBy === 'PERCENTAGE') {
          newPriceFromStrategy =
            competitorLowestPrice * (1 + (strategyData.value || 0.01));
          console.log(
            `🧮 STAY_ABOVE by PERCENTAGE: $${competitorLowestPrice} * (1 + ${
              strategyData.value
            }) = $${newPriceFromStrategy.toFixed(2)}`
          );
        }
        break;
      default:
        newPriceFromStrategy = competitorLowestPrice;
    }

    console.log(
      `💡 Strategy calculation result: $${newPriceFromStrategy.toFixed(2)}`
    );

    // Apply min/max constraints with detailed logging
    const originalCalculatedPrice = newPriceFromStrategy;

    if (strategyData.minPrice && newPriceFromStrategy < strategyData.minPrice) {
      console.log(
        `⚠️  CONSTRAINT: Calculated price $${newPriceFromStrategy.toFixed(
          2
        )} is below minimum $${strategyData.minPrice}`
      );
      console.log(
        `⬆️  ADJUSTING: Price adjusted from $${newPriceFromStrategy.toFixed(
          2
        )} to minimum $${strategyData.minPrice}`
      );
      newPriceFromStrategy = strategyData.minPrice;
    }

    if (strategyData.maxPrice && newPriceFromStrategy > strategyData.maxPrice) {
      console.log(
        `⚠️  CONSTRAINT: Calculated price $${newPriceFromStrategy.toFixed(
          2
        )} is above maximum $${strategyData.maxPrice}`
      );
      console.log(
        `⬇️  ADJUSTING: Price adjusted from $${newPriceFromStrategy.toFixed(
          2
        )} to maximum $${strategyData.maxPrice}`
      );
      newPriceFromStrategy = strategyData.maxPrice;
    }

    if (originalCalculatedPrice !== newPriceFromStrategy) {
      console.log(
        `🚨 PRICE CONSTRAINT APPLIED: Strategy wanted $${originalCalculatedPrice.toFixed(
          2
        )} but was limited to $${newPriceFromStrategy.toFixed(2)}`
      );
    } else {
      console.log(
        `✅ PRICE WITHIN LIMITS: Using strategy calculation $${newPriceFromStrategy.toFixed(
          2
        )}`
      );
    }

    console.log(
      `🧮 Final calculated price for ${itemId}: $${newPriceFromStrategy.toFixed(
        2
      )}`
    );

    // Get the item's details to check if it has variations/SKUs and Best Offer settings
    const getItemXml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${user.ebay.accessToken}</eBayAuthToken>
  </RequesterCredentials>
  <ItemID>${itemId}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeVariations>true</IncludeVariations>
</GetItemRequest>`;

    const getResponse = await axios({
      method: 'POST',
      url:
        process.env.NODE_ENV === 'production'
          ? 'https://api.ebay.com/ws/api.dll'
          : 'https://api.sandbox.ebay.com/ws/api.dll',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-CALL-NAME': 'GetItem',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
        'X-EBAY-API-APP-NAME': process.env.CLIENT_ID,
      },
      data: getItemXml,
    });

    const parser = new xml2js.Parser({
      explicitArray: false,
      ignoreAttrs: true,
    });

    const getResult = await new Promise((resolve, reject) => {
      parser.parseString(getResponse.data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const item = getResult.GetItemResponse.Item;
    const hasVariations = !!item.Variations;
    const itemSku = item.SKU;
    const hasBestOffer = !!item.BestOfferDetails;

    console.log(`📋 Item ${itemId} details:`, {
      hasVariations,
      itemSku,
      listingType: item.ListingType,
      hasBestOffer,
      bestOfferEnabled: item.BestOfferDetails?.BestOfferEnabled,
    });

    // Choose the right update method based on item type
    let updateXml;

    if (hasVariations) {
      // For variation items, use ReviseInventoryStatus with SKU
      const sku = itemSku || 'PART123';
      console.log(`📤 Updating variation item with SKU: ${sku}`);

      updateXml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${user.ebay.accessToken}</eBayAuthToken>
  </RequesterCredentials>
  <InventoryStatus>
    <ItemID>${itemId}</ItemID>
    <SKU>${sku}</SKU>
    <StartPrice>${newPriceFromStrategy.toFixed(2)}</StartPrice>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;
    } else {
      // For non-variation items, use ReviseItem without SKU
      console.log(`📤 Updating non-variation item (no SKU)`);

      // Build XML based on whether item has Best Offer
      if (hasBestOffer) {
        console.log(`📤 Item has Best Offer - disabling it for price update`);

        updateXml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${user.ebay.accessToken}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <ItemID>${itemId}</ItemID>
    <StartPrice>${newPriceFromStrategy.toFixed(2)}</StartPrice>
    <BestOfferDetails>
      <BestOfferEnabled>false</BestOfferEnabled>
    </BestOfferDetails>
  </Item>
</ReviseItemRequest>`;
      } else {
        updateXml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${user.ebay.accessToken}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <ItemID>${itemId}</ItemID>
    <StartPrice>${newPriceFromStrategy.toFixed(2)}</StartPrice>
  </Item>
</ReviseItemRequest>`;
      }
    }

    console.log(`📤 Sending strategy-driven eBay API request for ${itemId}`);

    const updateResponse = await axios({
      method: 'POST',
      url:
        process.env.NODE_ENV === 'production'
          ? 'https://api.ebay.com/ws/api.dll'
          : 'https://api.sandbox.ebay.com/ws/api.dll',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'X-EBAY-API-CALL-NAME': hasVariations
          ? 'ReviseInventoryStatus'
          : 'ReviseItem',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
        'X-EBAY-API-APP-NAME': process.env.CLIENT_ID,
        'User-Agent': 'Mozilla/5.0 (compatible; eBay-API-Client)',
        Connection: 'keep-alive',
      },
      data: updateXml,
      timeout: 30000,
    });

    const updateResult = await new Promise((resolve, reject) => {
      parser.parseString(updateResponse.data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    // Check success based on API call type
    const responseKey = hasVariations
      ? 'ReviseInventoryStatusResponse'
      : 'ReviseItemResponse';
    const isSuccess =
      updateResult[responseKey].Ack === 'Success' ||
      updateResult[responseKey].Ack === 'Warning';

    // Check for specific errors and warnings
    const errors = updateResult[responseKey].Errors;
    const warnings = [];
    const criticalErrors = [];

    if (errors) {
      const errorArray = Array.isArray(errors) ? errors : [errors];
      errorArray.forEach((error) => {
        if (error.SeverityCode === 'Warning') {
          warnings.push(error);
        } else if (error.SeverityCode === 'Error') {
          // Ignore some non-critical errors that don't prevent price updates
          if (error.ErrorCode === '22003') {
            // Auto decline amount issue
            warnings.push(error);
          } else {
            criticalErrors.push(error);
          }
        }
      });
    }

    const hasOnlyWarnings = criticalErrors.length === 0;

    // Determine status based on API response
    const statusForHistory =
      isSuccess && hasOnlyWarnings ? 'completed' : 'failed';

    if (isSuccess && hasOnlyWarnings) {
      const warningMessage =
        warnings.length > 0
          ? ` (with ${warnings.length} warnings: ${warnings
              .map((w) => w.ShortMessage)
              .join(', ')})`
          : '';

      console.log(
        `✅ STRATEGY successfully updated eBay price for ${itemId} to $${newPriceFromStrategy.toFixed(
          2
        )}${warningMessage}`
      );

      // 📝 SAVE TO MONGODB - Record the SUCCESSFUL price change in history
      try {
        console.log(`📝 💾 ATTEMPTING to save price change to MongoDB...`);

        const { recordPriceChange } = await import(
          '../services/historyService.js'
        );

        // FIX: Ensure all required data is properly formatted
        const priceChangeData = {
          userId: user._id,
          itemId,
          sku: itemSku || null, // Allow null SKU
          title: item.Title || null,
          oldPrice: myLandedPriceBefore, // My Landed Price (before change)
          newPrice: parseFloat(newPriceFromStrategy.toFixed(2)), // Sent Price (new price from strategy)
          currency: 'USD',
          competitorLowestPrice: competitorLowestPrice, // Competition Lowest Price
          strategyName: strategyData.strategyName, // Strategy Name from dropdown
          status: 'completed', // Use 'completed' instead of statusForHistory variable
          source: 'strategy',
          apiResponse: {
            ack: updateResult[responseKey].Ack,
            timestamp: updateResult[responseKey].Timestamp,
            apiUsed: hasVariations ? 'ReviseInventoryStatus' : 'ReviseItem',
            warnings: warnings.map((w) => w.ShortMessage),
          },
          success: true, // API was successful (status 200)
          error: null,
          metadata: {
            strategyData: {
              repricingRule: strategyData.repricingRule,
              originalCalculatedPrice: originalCalculatedPrice.toFixed(2),
              finalCalculatedPrice: newPriceFromStrategy.toFixed(2),
              constraintApplied:
                originalCalculatedPrice !== newPriceFromStrategy,
              minPriceLimit: strategyData.minPrice, // Min Price (Landed)
              maxPriceLimit: strategyData.maxPrice, // Max Price (Landed)
            },
          },
        };

        console.log(
          `📝 💾 Price change data to save:`,
          JSON.stringify(priceChangeData, null, 2)
        );

        const historyRecord = await recordPriceChange(priceChangeData);

        console.log(
          `📝 ✅ Price change saved to MongoDB successfully! Record ID:`,
          historyRecord._id
        );
      } catch (historyError) {
        console.error(
          `📝 ❌ FAILED to save price change to MongoDB:`,
          historyError
        );
        console.error(`📝 ❌ Full error details:`, {
          message: historyError.message,
          stack: historyError.stack,
          name: historyError.name,
        });
      }

      return {
        success: true,
        itemId,
        sku: itemSku || null,
        oldPrice: myLandedPriceBefore || competitorLowestPrice,
        newPrice: newPriceFromStrategy.toFixed(2),
        message: `Strategy-driven price update successful: $${
          myLandedPriceBefore || competitorLowestPrice
        } → $${newPriceFromStrategy.toFixed(2)}${warningMessage}`,
        priceUpdated: true,
        ebayResponse: updateResult[responseKey],
        apiUsed: hasVariations ? 'ReviseInventoryStatus' : 'ReviseItem',
        warnings: warnings,
        bestOfferDisabled: hasBestOffer,
      };
    } else {
      // 📝 SAVE TO MONGODB - Record the FAILED price change attempt
      try {
        console.log(
          `📝 💾 ATTEMPTING to save FAILED price change to MongoDB...`
        );

        const { recordPriceChange } = await import(
          '../services/historyService.js'
        );

        const failedPriceChangeData = {
          userId: user._id,
          itemId,
          sku: itemSku || null, // Allow null SKU
          title: item.Title || null,
          oldPrice: myLandedPriceBefore, // My Landed Price (before change)
          newPrice: parseFloat(newPriceFromStrategy.toFixed(2)), // Sent Price (attempted)
          currency: 'USD',
          competitorLowestPrice: competitorLowestPrice, // Competition Lowest Price
          strategyName: strategyData.strategyName, // Strategy Name from dropdown
          status: 'failed', // "failed" for unsuccessful API calls
          source: 'strategy',
          apiResponse: updateResult[responseKey],
          success: false, // API failed (not status 200)
          error: criticalErrors.length > 0 ? criticalErrors : errors,
          metadata: {
            strategyData: {
              repricingRule: strategyData.repricingRule,
              originalCalculatedPrice: originalCalculatedPrice.toFixed(2),
              finalCalculatedPrice: newPriceFromStrategy.toFixed(2),
              minPriceLimit: strategyData.minPrice, // Min Price (Landed)
              maxPriceLimit: strategyData.maxPrice, // Max Price (Landed)
            },
          },
        };

        const historyRecord = await recordPriceChange(failedPriceChangeData);

        console.log(
          `📝 ✅ Failed price change attempt saved to MongoDB:`,
