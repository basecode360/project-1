import axios from 'axios';
import xml2js from 'xml2js';
import PriceHistory from '../models/PriceHistory.js';

// Get item variations to find available SK
// Us
const getItemVariations = async (req, res) => {
  try {
    const { itemId } = req.params;
    const authToken = process.env.AUTH_TOKEN;
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
  let priceRecord = null;

  try {
    const {
      itemId,
      price,
      sku,
      currency = 'USD',
      title = null,
      userId = null,
    } = req.body;
    console.log(`itemId => ${itemId}, price => ${price}, sku => ${sku}`);

    if (!itemId || !price || !sku) {
      return res.status(400).json({
        success: false,
        message:
          'Required fields are missing (itemId, price, and sku required for variation items)',
      });
    }

    // Get the current price before updating (for tracking change)
    let oldPrice = null;
    try {
      const latestPriceRecord = await PriceHistory.getLatestPrice(itemId, sku);
      if (latestPriceRecord) {
        oldPrice = latestPriceRecord.newPrice;
      }
    } catch (err) {
      console.warn(
        `Could not retrieve previous price for ${itemId}/${sku}: ${err.message}`
      );
    }

    // Calculate price change metrics
    const priceValue = parseFloat(price);
    let changeAmount = null;
    let changePercentage = null;
    let changeDirection = null;

    if (oldPrice !== null) {
      changeAmount = priceValue - oldPrice;
      if (oldPrice > 0) {
        changePercentage = ((priceValue - oldPrice) / oldPrice) * 100;
      }
      changeDirection =
        changeAmount > 0
          ? 'increased'
          : changeAmount < 0
          ? 'decreased'
          : 'unchanged';
    }

    // Create a price history record (initially marked as unsuccessful)
    priceRecord = new PriceHistory({
      itemId,
      sku,
      title,
      oldPrice,
      newPrice: priceValue,
      currency,
      changeAmount,
      changePercentage,
      changeDirection,
      source: 'api',
      success: false,
      userId,
    });

    // Save the initial record to track the attempt
    await priceRecord.save();

    const authToken = process.env.AUTH_TOKEN;

    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <InventoryStatus>
    <ItemID>${itemId}</ItemID>
    <SKU>${sku}</SKU>
    <StartPrice>${price}</StartPrice>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;

    const response = await axios({
      method: 'POST',
      url:
        process.env.NODE_ENV === 'development'
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
      // Update the price history record with success info
      priceRecord.success = true;
      priceRecord.apiResponse = {
        ack: reviseResponse.Ack,
        timestamp: reviseResponse.Timestamp,
        inventoryStatus: reviseResponse.InventoryStatus,
      };

      // Add any warnings to metadata
      if (reviseResponse.Ack === 'Warning' && reviseResponse.Errors) {
        priceRecord.metadata.warnings = Array.isArray(reviseResponse.Errors)
          ? reviseResponse.Errors
          : [reviseResponse.Errors];
      }

      // Save the updated record
      await priceRecord.save();

      return res.status(200).json({
        success: true,
        message: `Price updated successfully to ${price} ${currency} for SKU: ${sku}`,
        priceChangeTracked: true,
        priceHistory: {
          id: priceRecord._id,
          oldPrice,
          newPrice: priceValue,
          changeAmount,
          changePercentage: changePercentage?.toFixed(2) || null,
          changeDirection,
        },
        data: {
          itemId: reviseResponse.InventoryStatus?.ItemID,
          sku: reviseResponse.InventoryStatus?.SKU,
          startPrice: reviseResponse.InventoryStatus?.StartPrice,
          timestamp: reviseResponse.Timestamp,
        },
      });
    } else {
      throw new Error(JSON.stringify(reviseResponse.Errors));
    }
  } catch (error) {
    const errorMessage = error.response?.data || error.message;
    console.error('Error updating variation price:', errorMessage);

    // Update the price history record with error info
    if (priceRecord) {
      priceRecord.success = false;
      priceRecord.error = {
        message: errorMessage,
        stack: error.stack,
        responseStatus: error.response?.status,
      };

      // Save the updated record with error information
      await priceRecord.save().catch((err) => {
        console.error(
          'Failed to update price history with error details:',
          err
        );
      });
    }

    return res.status(error.response?.status || 500).json({
      success: false,
      message: 'Error updating variation price',
      priceChangeTracked: !!priceRecord,
      error: errorMessage,
    });
  }
};

const editAllVariationsPrices = async (req, res) => {
  try {
    const { itemId, price, currency = 'USD' } = req.body;

    if (!itemId || !price) {
      return res.status(400).json({
        success: false,
        message: 'Required fields are missing (itemId and price required)',
      });
    }

    // First get all variations
    const authToken = process.env.AUTH_TOKEN;

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
      const currentAuthToken = process.env.AUTH_TOKEN;

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
          url:
            process.env.NODE_ENV === 'production'
              ? 'https://api.ebay.com/ws/api.dll'
              : 'https://api.sandbox.ebay.com/ws/api.dll',
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

export default {
  getItemVariations,
  editVariationPrice,
  editAllVariationsPrices,
};
