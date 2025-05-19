import axios from 'axios';
import xml2js from 'xml2js';

// Get current pricing strategy for a listing
const getPricingStrategy = async (req, res) => {
  try {
    const { itemId } = req.params;
    const authToken = process.env.AUTH_TOKEN;

    // Get item details including pricing information
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <ItemID>${itemId}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
</GetItemRequest>`;

    const response = await axios({
      method: 'POST',
      url: process.env.NODE_ENV === 'development' 
        ? 'https://api.ebay.com/ws/api.dll' 
        : 'https://api.sandbox.ebay.com/ws/api.dll',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'X-EBAY-API-CALL-NAME': 'GetItem',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
        'X-EBAY-API-APP-NAME': process.env.CLIENT_ID
      },
      data: xmlRequest,
      timeout: 30000
    });

    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
    const result = await new Promise((resolve, reject) => {
      parser.parseString(response.data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const getItemResponse = result.GetItemResponse;
    
    if (getItemResponse.Ack === 'Success') {
      const item = getItemResponse.Item;
      
      return res.status(200).json({
        success: true,
        message: "Current pricing information retrieved",
        data: {
          itemId: item.ItemID,
          title: item.Title,
          currentPrice: item.StartPrice || item.ConvertedCurrentPrice,
          currency: item.Currency,
          listingType: item.ListingType,
          buyItNowPrice: item.BuyItNowPrice,
          minimumBestOfferPrice: item.BestOfferDetails?.BestOfferAutoAcceptPrice,
          category: item.PrimaryCategory,
          condition: item.ConditionDisplayName,
          hasVariations: !!item.Variations,
          pricing: {
            strategy: 'manual', // Default since eBay doesn't expose strategy directly
            currentStrategy: extractPricingStrategy(item),
            lastUpdated: item.ReviseStatus?.ItemRevised || item.StartTime
          }
        }
      });
    } else {
      throw new Error(JSON.stringify(getItemResponse.Errors));
    }

  } catch (error) {
    console.error('Error getting pricing strategy:', error);
    return res.status(500).json({
      success: false,
      message: "Error getting pricing strategy",
      error: error.message
    });
  }
};
// Modified setPricingStrategy function
const setPricingStrategy = async (req, res) => {
  try {
    const { 
      itemId, 
      strategy,
      minPrice,
      maxPrice,
      targetPrice,
      repriceFrequency = 'daily',
      competitorAdjustment = 0,
      enableBestOffer = false,
      bestOfferAutoAccept,
      bestOfferAutoDecline
    } = req.body;

    if (!itemId || !strategy) {
      return res.status(400).json({
        success: false,
        message: "ItemID and strategy are required"
      });
    }

    const authToken = process.env.AUTH_TOKEN;

    // First, get the current item details to preserve existing item specifics
    const currentItem = await getItemDetails(itemId, authToken);
    if (!currentItem.success) {
      return res.status(400).json({
        success: false,
        message: "Failed to retrieve current item details",
        error: currentItem.error
      });
    }

    // Extract existing item specifics
    const existingSpecifics = extractItemSpecifics(currentItem.data);
    
    // Build XML based on strategy type
    let pricingXML = '';
    
    switch (strategy) {
      case 'fixed':
        if (!targetPrice) {
          return res.status(400).json({
            success: false,
            message: "Target price is required for fixed strategy"
          });
        }
        pricingXML = `
          <StartPrice>${targetPrice}</StartPrice>
          ${enableBestOffer ? `
            <BestOfferDetails>
              <BestOfferEnabled>true</BestOfferEnabled>
              ${bestOfferAutoAccept ? `<BestOfferAutoAcceptPrice>${bestOfferAutoAccept}</BestOfferAutoAcceptPrice>` : ''}
              ${bestOfferAutoDecline ? `<BestOfferAutoDeclinePrice>${bestOfferAutoDecline}</BestOfferAutoDeclinePrice>` : ''}
            </BestOfferDetails>
          ` : ''}
          ${generateItemSpecificsXML(existingSpecifics)}
        `;
        break;
        
      case 'competitive':
        if (!minPrice || !maxPrice) {
          return res.status(400).json({
            success: false,
            message: "Min and max prices are required for competitive strategy"
          });
        }
        
        // Add pricing strategy to existing specifics
        const competitiveSpecifics = {
          ...existingSpecifics,
          PricingStrategy: 'competitive',
          MinPrice: minPrice,
          MaxPrice: maxPrice,
          RepricingFrequency: repriceFrequency
        };
        
        // For competitive pricing, set initial price and store strategy in item specifics
        pricingXML = `
          <StartPrice>${targetPrice || ((parseFloat(minPrice) + parseFloat(maxPrice)) / 2)}</StartPrice>
          ${generateItemSpecificsXML(competitiveSpecifics)}
        `;
        break;
        
      case 'dynamic':
        if (!minPrice || !maxPrice) {
          return res.status(400).json({
            success: false,
            message: "Min and max prices are required for dynamic strategy"
          });
        }
        
        // Add pricing strategy to existing specifics
        const dynamicSpecifics = {
          ...existingSpecifics,
          PricingStrategy: 'dynamic',
          MinPrice: minPrice,
          MaxPrice: maxPrice,
          CompetitorAdjustment: competitorAdjustment
        };
        
        pricingXML = `
          <StartPrice>${targetPrice || ((parseFloat(minPrice) + parseFloat(maxPrice)) / 2)}</StartPrice>
          ${generateItemSpecificsXML(dynamicSpecifics)}
        `;
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: "Invalid strategy. Use 'fixed', 'competitive', or 'dynamic'"
        });
    }

    // Handle variations if they exist
    let variationsXML = '';
    if (currentItem.data.hasVariations && currentItem.data.variations) {
      variationsXML = generateVariationsXML(currentItem.data.variations, strategy, targetPrice);
    }

    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <Item>
    <ItemID>${itemId}</ItemID>
    ${pricingXML}
    ${variationsXML}
  </Item>
</ReviseItemRequest>`;

    const response = await axios({
      method: 'POST',
      url: process.env.NODE_ENV === 'development' 
        ? 'https://api.ebay.com/ws/api.dll' 
        : 'https://api.sandbox.ebay.com/ws/api.dll',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'X-EBAY-API-CALL-NAME': 'ReviseItem',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
        'X-EBAY-API-APP-NAME': process.env.CLIENT_ID
      },
      data: xmlRequest,
      timeout: 30000
    });

    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
    const result = await new Promise((resolve, reject) => {
      parser.parseString(response.data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const reviseResponse = result.ReviseItemResponse;
    
    if (reviseResponse.Ack === 'Success' || reviseResponse.Ack === 'Warning') {
      return res.status(200).json({
        success: true,
        message: `Pricing strategy '${strategy}' applied successfully`,
        data: {
          itemId: reviseResponse.ItemID,
          strategy: strategy,
          startPrice: reviseResponse.StartPrice,
          fees: reviseResponse.Fees,
          timestamp: reviseResponse.Timestamp,
          warnings: reviseResponse.Errors || []
        }
      });
    } else {
      throw new Error(JSON.stringify(reviseResponse.Errors));
    }

  } catch (error) {
    const errorMessage = error.response?.data || error.message;
    console.error('Error setting pricing strategy:', errorMessage);
    return res.status(error.response?.status || 500).json({
      success: false,
      message: "Error setting pricing strategy",
      error: errorMessage
    });
  }
};

// Helper function to get full item details
async function getItemDetails(itemId, authToken) {
  try {
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <ItemID>${itemId}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeItemSpecifics>true</IncludeItemSpecifics>
</GetItemRequest>`;

    const response = await axios({
      method: 'POST',
      url: process.env.NODE_ENV === 'development' 
        ? 'https://api.ebay.com/ws/api.dll' 
        : 'https://api.sandbox.ebay.com/ws/api.dll',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'X-EBAY-API-CALL-NAME': 'GetItem',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
        'X-EBAY-API-APP-NAME': process.env.CLIENT_ID
      },
      data: xmlRequest,
      timeout: 30000
    });

    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
    const result = await new Promise((resolve, reject) => {
      parser.parseString(response.data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const getItemResponse = result.GetItemResponse;
    
    if (getItemResponse.Ack === 'Success' || getItemResponse.Ack === 'Warning') {
      return {
        success: true,
        data: {
          ...getItemResponse.Item,
          hasVariations: !!getItemResponse.Item.Variations,
          variations: getItemResponse.Item.Variations
        }
      };
    } else {
      return {
        success: false,
        error: JSON.stringify(getItemResponse.Errors)
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// Extract item specifics from the item data
function extractItemSpecifics(item) {
  const specifics = {};
  
  if (item.ItemSpecifics && item.ItemSpecifics.NameValueList) {
    const nameValueLists = Array.isArray(item.ItemSpecifics.NameValueList) 
      ? item.ItemSpecifics.NameValueList 
      : [item.ItemSpecifics.NameValueList];
      
    nameValueLists.forEach(nvPair => {
      if (nvPair.Name && nvPair.Value) {
        specifics[nvPair.Name] = nvPair.Value;
      }
    });
  }
  
  // Ensure required specifics exist
  if (!specifics.Brand) {
    specifics.Brand = "Unbranded"; // Default value for Brand
  }
  
  if (!specifics.Type) {
    specifics.Type = "Wall Hanging"; // Default value for Type based on the item category
  }
  
  return specifics;
}

// Generate XML for item specifics
function generateItemSpecificsXML(specifics) {
  if (!specifics || Object.keys(specifics).length === 0) {
    return '';
  }
  
  let specificsXML = '<ItemSpecifics>';
  
  for (const [name, value] of Object.entries(specifics)) {
    specificsXML += `
      <NameValueList>
        <Name>${name}</Name>
        <Value>${value}</Value>
      </NameValueList>`;
  }
  
  specificsXML += '</ItemSpecifics>';
  
  return specificsXML;
}

// Generate XML for variations if they exist
function generateVariationsXML(variations, strategy, targetPrice) {
  if (!variations || !variations.Variation) {
    return '';
  }
  
  const variationArr = Array.isArray(variations.Variation) 
    ? variations.Variation 
    : [variations.Variation];
  
  if (variationArr.length === 0) {
    return '';
  }
  
  let variationsXML = '<Variations>';
  
  variationArr.forEach(variation => {
    // For each variation, we need to set the price based on the strategy
    let variationPrice = variation.StartPrice ? variation.StartPrice : targetPrice;
    
    variationsXML += `
      <Variation>
        <SKU>${variation.SKU || ''}</SKU>
        <StartPrice>${variationPrice}</StartPrice>
        ${variation.VariationSpecifics ? generateVariationSpecificsXML(variation.VariationSpecifics) : ''}
      </Variation>`;
  });
  
  variationsXML += '</Variations>';
  
  return variationsXML;
}

// Generate XML for variation specifics
function generateVariationSpecificsXML(variationSpecifics) {
  if (!variationSpecifics || !variationSpecifics.NameValueList) {
    return '';
  }
  
  const nvLists = Array.isArray(variationSpecifics.NameValueList) 
    ? variationSpecifics.NameValueList 
    : [variationSpecifics.NameValueList];
  
  let specXML = '<VariationSpecifics>';
  
  nvLists.forEach(nv => {
    specXML += `
      <NameValueList>
        <Name>${nv.Name}</Name>
        <Value>${nv.Value}</Value>
      </NameValueList>`;
  });
  
  specXML += '</VariationSpecifics>';
  
  return specXML;
}

// Helper function for single item pricing strategy update in bulk operations
async function setSingleItemPricingStrategy(params) {
  const { itemId, strategy, minPrice, maxPrice, targetPrice, repriceFrequency, competitorAdjustment } = params;
  const authToken = process.env.AUTH_TOKEN;

  try {
    // First, get the current item details to preserve existing item specifics
    const currentItem = await getItemDetails(itemId, authToken);
    if (!currentItem.success) {
      throw new Error(currentItem.error);
    }

    // Extract existing item specifics
    const existingSpecifics = extractItemSpecifics(currentItem.data);
    
    let pricingXML = '';
    
    switch (strategy) {
      case 'fixed':
        pricingXML = `
          <StartPrice>${targetPrice}</StartPrice>
          ${generateItemSpecificsXML(existingSpecifics)}
        `;
        break;
      case 'competitive':
        // Add pricing strategy to existing specifics
        const competitiveSpecifics = {
          ...existingSpecifics,
          PricingStrategy: 'competitive',
          MinPrice: minPrice,
          MaxPrice: maxPrice,
          RepricingFrequency: repriceFrequency
        };
        
        pricingXML = `
          <StartPrice>${targetPrice || ((parseFloat(minPrice) + parseFloat(maxPrice)) / 2)}</StartPrice>
          ${generateItemSpecificsXML(competitiveSpecifics)}
        `;
        break;
      case 'dynamic':
        // Add pricing strategy to existing specifics
        const dynamicSpecifics = {
          ...existingSpecifics,
          PricingStrategy: 'dynamic',
          MinPrice: minPrice,
          MaxPrice: maxPrice,
          CompetitorAdjustment: competitorAdjustment
        };
        
        pricingXML = `
          <StartPrice>${targetPrice || ((parseFloat(minPrice) + parseFloat(maxPrice)) / 2)}</StartPrice>
          ${generateItemSpecificsXML(dynamicSpecifics)}
        `;
        break;
    }

    // Handle variations if they exist
    let variationsXML = '';
    if (currentItem.data.hasVariations && currentItem.data.variations) {
      variationsXML = generateVariationsXML(currentItem.data.variations, strategy, targetPrice);
    }

    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <ItemID>${itemId}</ItemID>
    ${pricingXML}
    ${variationsXML}
  </Item>
</ReviseItemRequest>`;

    const response = await axios({
      method: 'POST',
      url: process.env.NODE_ENV === 'development' 
        ? 'https://api.ebay.com/ws/api.dll' 
        : 'https://api.sandbox.ebay.com/ws/api.dll',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'X-EBAY-API-CALL-NAME': 'ReviseItem',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
        'X-EBAY-API-APP-NAME': process.env.CLIENT_ID
      },
      data: xmlRequest,
      timeout: 30000
    });

    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
    const result = await new Promise((resolve, reject) => {
      parser.parseString(response.data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const reviseResponse = result.ReviseItemResponse;
    
    if (reviseResponse.Ack === 'Success' || reviseResponse.Ack === 'Warning') {
      return reviseResponse;
    } else {
      throw new Error(JSON.stringify(reviseResponse.Errors));
    }
  } catch (error) {
    throw error;
  }
}

// Bulk assign pricing strategy to multiple listings
const setBulkPricingStrategy = async (req, res) => {
  try {
    const { 
      itemIds, 
      strategy,
      minPrice,
      maxPrice,
      targetPrice,
      repriceFrequency = 'daily',
      competitorAdjustment = 0
    } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ItemIds array is required"
      });
    }

    if (!strategy) {
      return res.status(400).json({
        success: false,
        message: "Strategy is required"
      });
    }

    const results = [];
    
    for (let i = 0; i < itemIds.length; i++) {
      const itemId = itemIds[i];
      
      // Add delay between requests to avoid rate limiting
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      try {
        console.log(`Updating pricing strategy for item ${i + 1}/${itemIds.length}: ${itemId}`);
        
        // Create individual request for each item
        const singleResult = await setSingleItemPricingStrategy({
          itemId,
          strategy,
          minPrice,
          maxPrice,
          targetPrice,
          repriceFrequency,
          competitorAdjustment
        });

        results.push({
          itemId: itemId,
          success: true,
          strategy: strategy,
          data: singleResult
        });

        console.log(`Item ${itemId}: SUCCESS`);
        
      } catch (error) {
        console.error(`Error updating item ${itemId}:`, error.message);
        results.push({
          itemId: itemId,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const totalCount = results.length;

    return res.status(200).json({
      success: successCount > 0,
      message: `Updated pricing strategy for ${successCount}/${totalCount} items`,
      data: {
        strategy: strategy,
        totalItems: totalCount,
        successfulUpdates: successCount,
        failedUpdates: totalCount - successCount,
        results: results
      }
    });

  } catch (error) {
    console.error('Error setting bulk pricing strategy:', error);
    return res.status(500).json({
      success: false,
      message: "Error setting bulk pricing strategy",
      error: error.message
    });
  }
};

// Helper function to extract current pricing strategy from item data
function extractPricingStrategy(item) {
  // Check item specifics for pricing strategy indicators
  const specifics = item.ItemSpecifics?.NameValueList || [];
  const specificsArray = Array.isArray(specifics) ? specifics : [specifics];
  
  let strategy = {
    type: 'manual',
    minPrice: null,
    maxPrice: null,
    repricingFrequency: null,
    competitorAdjustment: null
  };

  specificsArray.forEach(specific => {
    if (specific.Name === 'PricingStrategy') {
      strategy.type = specific.Value;
    } else if (specific.Name === 'MinPrice') {
      strategy.minPrice = specific.Value;
    } else if (specific.Name === 'MaxPrice') {
      strategy.maxPrice = specific.Value;
    } else if (specific.Name === 'RepricingFrequency') {
      strategy.repricingFrequency = specific.Value;
    } else if (specific.Name === 'CompetitorAdjustment') {
      strategy.competitorAdjustment = specific.Value;
    }
  });

  return strategy;
}

export default {
  getPricingStrategy,
  setPricingStrategy,
  setBulkPricingStrategy
};