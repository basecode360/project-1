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
// Modified setPricingStrategy function with time-based strategy support
const setPricingStrategy = async (req, res) => {
  try {
    const { 
      itemId, 
      strategy,
      // Fixed strategy parameters
      minPrice,
      maxPrice,
      targetPrice,
      // Competitive strategy parameters
      repriceFrequency = 'daily',
      competitorAdjustment = 0,
      // Best Offer parameters
      enableBestOffer = false,
      bestOfferAutoAccept,
      bestOfferAutoDecline,
      // Time-based strategy parameters
      basePrice,
      weekendBoost,
      holidayBoost,
      clearanceThreshold
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
          RepricingFrequency: repriceFrequency,
          CompetitorAdjustment: competitorAdjustment
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
      
      case 'time-based':
        if (!basePrice) {
          return res.status(400).json({
            success: false,
            message: "Base price is required for time-based strategy"
          });
        }
        
        // Set default values if not provided
        const weekendBoostValue = weekendBoost || 1.0;
        const holidayBoostValue = holidayBoost || 1.0;
        const clearanceThresholdValue = clearanceThreshold || 0;
        
        // Add time-based pricing strategy to existing specifics
        const timeBasedSpecifics = {
          ...existingSpecifics,
          PricingStrategy: 'time-based',
          BasePrice: basePrice,
          WeekendBoost: weekendBoostValue,
          HolidayBoost: holidayBoostValue,
          ClearanceThreshold: clearanceThresholdValue
        };
        
        // For time-based pricing, calculate current price based on day of week/holidays
        const currentPrice = calculateTimeBasedPrice(
          parseFloat(basePrice), 
          parseFloat(weekendBoostValue), 
          parseFloat(holidayBoostValue),
          parseInt(clearanceThresholdValue, 10)
        );
        
        pricingXML = `
          <StartPrice>${currentPrice}</StartPrice>
          ${generateItemSpecificsXML(timeBasedSpecifics)}
        `;
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: "Invalid strategy. Use 'fixed', 'competitive', 'dynamic', or 'time-based'"
        });
    }

    // Handle variations if they exist
    let variationsXML = '';
    if (currentItem.data.hasVariations && currentItem.data.variations) {
      variationsXML = generateVariationsXML(
        currentItem.data.variations, 
        strategy, 
        strategy === 'time-based' ? basePrice : targetPrice
      );
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

// Helper function to calculate time-based price
function calculateTimeBasedPrice(basePrice, weekendBoost, holidayBoost, clearanceThreshold) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
  // Check if today is a holiday (simplified approach)
  const isHoliday = isHolidayToday();
  
  // Check if item should be on clearance
  const daysToConsiderClearance = clearanceThreshold || 0;
  const shouldApplyClearance = daysToConsiderClearance > 0 && shouldBeOnClearance(daysToConsiderClearance);
  
  let finalPrice = basePrice;
  
  // Apply weekend boost if applicable
  if (isWeekend && weekendBoost) {
    finalPrice *= weekendBoost;
  }
  
  // Apply holiday boost if applicable (takes precedence over weekend)
  if (isHoliday && holidayBoost) {
    finalPrice *= holidayBoost;
  }
  
  // Apply clearance discount if applicable (overrides all other boosts)
  if (shouldApplyClearance) {
    // Apply a 20% discount for clearance
    finalPrice *= 0.8;
  }
  
  // Round to two decimal places
  return parseFloat(finalPrice.toFixed(2));
}

// Helper function to check if today is a holiday
function isHolidayToday() {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const date = now.getDate(); // 1-31
  
  // US holidays (simplified)
  const holidays = [
    { month: 0, date: 1 },    // New Year's Day
    { month: 1, date: 14 },   // Valentine's Day
    { month: 6, date: 4 },    // Independence Day
    { month: 10, date: 25 },  // Thanksgiving (approximation)
    { month: 11, date: 25 },  // Christmas
  ];
  
  return holidays.some(holiday => holiday.month === month && holiday.date === date);
}

// Helper function to determine if an item should be on clearance
function shouldBeOnClearance(daysThreshold) {
  // In a real implementation, you would check:
  // 1. How long the item has been listed
  // 2. Current stock levels
  // 3. Sales velocity
  
  // This is a simplified placeholder - in a real implementation,
  // you would query item metrics from your database
  
  // Placeholder: 20% chance of putting item on clearance if clearance is enabled
  return Math.random() < 0.2;
}


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
  const { 
    itemId, 
    strategy, 
    minPrice, 
    maxPrice, 
    targetPrice, 
    repriceFrequency, 
    competitorAdjustment,
    basePrice,
    weekendBoost,
    holidayBoost,
    clearanceThreshold
  } = params;
  
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
          RepricingFrequency: repriceFrequency,
          CompetitorAdjustment: competitorAdjustment
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
        
      case 'time-based':
        // Add time-based pricing strategy to existing specifics
        const timeBasedSpecifics = {
          ...existingSpecifics,
          PricingStrategy: 'time-based',
          BasePrice: basePrice,
          WeekendBoost: weekendBoost || 1.0,
          HolidayBoost: holidayBoost || 1.0,
          ClearanceThreshold: clearanceThreshold || 0
        };
        
        // For time-based pricing, calculate current price based on day of week/holidays
        const currentPrice = calculateTimeBasedPrice(
          parseFloat(basePrice), 
          parseFloat(weekendBoost || 1.0), 
          parseFloat(holidayBoost || 1.0),
          parseInt(clearanceThreshold || 0, 10)
        );
        
        pricingXML = `
          <StartPrice>${currentPrice}</StartPrice>
          ${generateItemSpecificsXML(timeBasedSpecifics)}
        `;
        break;
    }

    // Handle variations if they exist
    let variationsXML = '';
    if (currentItem.data.hasVariations && currentItem.data.variations) {
      variationsXML = generateVariationsXML(
        currentItem.data.variations, 
        strategy, 
        strategy === 'time-based' ? basePrice : targetPrice
      );
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
      // Fixed, Competitive, Dynamic strategy parameters
      minPrice,
      maxPrice,
      targetPrice,
      repriceFrequency = 'daily',
      competitorAdjustment = 0,
      // Time-based strategy parameters
      basePrice,
      weekendBoost,
      holidayBoost,
      clearanceThreshold
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

    // Validate strategy-specific required parameters
    if (strategy === 'fixed' && !targetPrice) {
      return res.status(400).json({
        success: false,
        message: "Target price is required for fixed strategy"
      });
    }
    
    if ((strategy === 'competitive' || strategy === 'dynamic') && (!minPrice || !maxPrice)) {
      return res.status(400).json({
        success: false,
        message: `Min and max prices are required for ${strategy} strategy`
      });
    }
    
    if (strategy === 'time-based' && !basePrice) {
      return res.status(400).json({
        success: false,
        message: "Base price is required for time-based strategy"
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
          competitorAdjustment,
          basePrice,
          weekendBoost,
          holidayBoost,
          clearanceThreshold
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
    competitorAdjustment: null,
    basePrice: null,
    weekendBoost: null,
    holidayBoost: null,
    clearanceThreshold: null
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
    } else if (specific.Name === 'BasePrice') {
      strategy.basePrice = specific.Value;
    } else if (specific.Name === 'WeekendBoost') {
      strategy.weekendBoost = specific.Value;
    } else if (specific.Name === 'HolidayBoost') {
      strategy.holidayBoost = specific.Value;
    } else if (specific.Name === 'ClearanceThreshold') {
      strategy.clearanceThreshold = specific.Value;
    }
  });

  // Add additional properties based on strategy type
  if (strategy.type === 'time-based') {
    // For time-based, calculate next price update date
    const nextUpdate = calculateNextPriceUpdateDate();
    strategy.nextScheduledUpdate = nextUpdate;
  } else if (strategy.type === 'competitive' || strategy.type === 'dynamic') {
    // For competitive/dynamic pricing, add market position info if available
    strategy.marketPosition = 'competitive'; // Example value, would be determined by analysis
  }

  return strategy;
}

// Helper function to calculate next price update date
function calculateNextPriceUpdateDate() {
  const now = new Date();
  
  // Check upcoming weekends and holidays to determine next price change
  const nextFriday = new Date(now);
  nextFriday.setDate(now.getDate() + ((5 + 7 - now.getDay()) % 7));
  
  // Format date as ISO string
  return nextFriday.toISOString();
}

export default {
  getPricingStrategy,
  setPricingStrategy,
  setBulkPricingStrategy
};



/*
POST /api/pricing-strategy
{
  "itemId": "314851424639",
  "strategy": "fixed",
  "targetPrice": "80.00",
  "enableBestOffer": true,
  "bestOfferAutoAccept": "75.00",
  "bestOfferAutoDecline": "60.00"
}

POST /api/pricing-strategy
{
  "itemId": "314851424639",
  "strategy": "competitive", 
  "minPrice": "50.00",
  "maxPrice": "100.00",
  "targetPrice": "75.00",
  "repriceFrequency": "daily",
  "competitorAdjustment": -5
}


POST /api/pricing-strategy
{
  "itemId": "314851424639",
  "strategy": "dynamic",
  "minPrice": "45.00",
  "maxPrice": "95.00",
  "competitorAdjustment": 0
  "demandMultiplier": 1.2,        // Increase price when high demand
  "inventoryThreshold": 10       // Raise price when low stock
}


POST /api/pricing-strategy/bulk
{
  "itemIds": ["314851424639", "314851424640", "314851424641"],
  "strategy": "competitive",
  "minPrice": "50.00",
  "maxPrice": "100.00",
  "targetPrice": "75.00",
  "repriceFrequency": "daily"
}

{
  "itemId": "314851424639",
  "strategy": "time-based",
  "basePrice": 75.00,
  "weekendBoost": 1.1,
  "holidayBoost": 1.25,
  "clearanceThreshold": 30
}
*/