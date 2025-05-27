import axios from 'axios';
import xml2js from 'xml2js'

/**
 * Trigger auto-sync of listings
 * Main endpoint for starting the sync process
 */
const triggerAutoSync = async (req, res) => {
  console.log('🔄 Triggering auto-sync with parameters:');
  try {
    const {
      syncType = 'all',           // all, price, inventory, description
      batchSize = 25,             // Number of listings to process at once
      delayBetweenBatches = 2000, // Delay in milliseconds between batches
      forceUpdate = false,        // Force update even if no changes detected
      dryRun = false             // Preview changes without applying them
    } = req.query;

    console.log(`🚀 Starting auto-sync: ${syncType} | Batch size: ${batchSize} | Dry run: ${dryRun}`);

    // Step 1: Get active listings from eBay
    const listings = await fetchActiveListings(batchSize * 5); // Get more than batch size
    
    if (listings.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No active listings found to sync',
        data: {
          totalListings: 0,
          processedCount: 0,
          successCount: 0,
          errorCount: 0,
          results: []
        }
      });
    }

    console.log(`📦 Found ${listings.length} active listings`);

    // Step 2: Process listings in batches
    const syncResults = {
      startTime: new Date().toISOString(),
      totalListings: listings.length,
      processedCount: 0,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      dryRun: dryRun,
      syncType: syncType,
      results: []
    };

    // Process in batches to avoid overwhelming the API
    for (let i = 0; i < listings.length; i += batchSize) {
      const batch = listings.slice(i, i + batchSize);
      console.log(`📋 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(listings.length / batchSize)}`);

      // Process each listing in the batch
      for (const listing of batch) {
        try {
          const result = await processListing(listing, syncType, forceUpdate, dryRun);
          
          syncResults.processedCount++;
          if (result.success) {
            if (result.skipped) {
              syncResults.skippedCount++;
            } else {
              syncResults.successCount++;
            }
          } else {
            syncResults.errorCount++;
          }

          syncResults.results.push({
            itemId: listing.itemId,
            title: listing.title.substring(0, 50) + '...',
            status: result.success ? (result.skipped ? 'skipped' : 'success') : 'error',
            changes: result.changes || [],
            message: result.message,
            error: result.error || null
          });

          // Small delay between individual items
          await delay(200);

        } catch (error) {
          console.error(`❌ Error processing listing ${listing.itemId}:`, error.message);
          syncResults.errorCount++;
          syncResults.processedCount++;
          
          syncResults.results.push({
            itemId: listing.itemId,
            title: listing.title.substring(0, 50) + '...',
            status: 'error',
            changes: [],
            message: 'Processing failed',
            error: error.message
          });
        }
      }

      // Delay between batches to respect rate limits
      if (i + batchSize < listings.length) {
        console.log(`⏱️ Waiting ${delayBetweenBatches}ms before next batch...`);
        await delay(delayBetweenBatches);
      }
    }

    // Step 3: Finalize results
    syncResults.endTime = new Date().toISOString();
    syncResults.duration = new Date(syncResults.endTime) - new Date(syncResults.startTime);

    console.log(`✅ Sync completed: ${syncResults.successCount} success, ${syncResults.errorCount} errors, ${syncResults.skippedCount} skipped`);

    // Step 4: Save sync history (optional)
    // await saveSyncHistory(syncResults);

    return res.status(200).json({
      success: true,
      message: `Auto-sync completed: ${syncResults.successCount} updated, ${syncResults.errorCount} errors, ${syncResults.skippedCount} skipped`,
      data: syncResults
    });

  } catch (error) {
    console.error('❌ Auto-sync failed:', error);
    return res.status(500).json({
      success: false,
      message: 'Auto-sync failed',
      error: error.message
    });
  }
};

/**
 * Fetch active listings from eBay with variation details
 */
async function fetchActiveListings(limit = 100) {
  try {
    const authToken = process.env.AUTH_TOKEN;

    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${Math.min(limit, 200)}</EntriesPerPage>
      <PageNumber>1</PageNumber>
    </Pagination>
    <IncludeVariations>true</IncludeVariations>
  </ActiveList>
</GetMyeBaySellingRequest>`;

    const response = await axios({
      method: 'POST',
      url: process.env.NODE_ENV === 'development' 
        ? 'https://api.ebay.com/ws/api.dll' 
        : 'https://api.sandbox.ebay.com/ws/api.dll',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
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

    const sellingResponse = result.GetMyeBaySellingResponse;
    
    if (sellingResponse.Ack === 'Success' || sellingResponse.Ack === 'Warning') {
      const activeList = sellingResponse.ActiveList;
      const items = activeList?.ItemArray?.Item || [];
      const itemsArray = Array.isArray(items) ? items : [items];
      
      // Process each item and handle variations
      const processedListings = [];
      
      for (const item of itemsArray) {
        if (item.Variations) {
          // Item has variations - create separate entries for each variation
          const variations = Array.isArray(item.Variations.Variation) 
            ? item.Variations.Variation 
            : [item.Variations.Variation];
            
          for (const variation of variations) {
            processedListings.push({
              itemId: item.ItemID,
              title: item.Title,
              sku: variation.SKU,
              currentPrice: parseFloat(variation.StartPrice || 0),
              quantity: parseInt(variation.Quantity || 0, 10),
              currency: item.SellingStatus?.CurrentPrice?.['@currencyID'] || 'USD',
              hasVariations: true,
              listingType: item.ListingType,
              lastModified: item.ReviseStatus?.ItemRevised || item.StartTime,
              variationSpecifics: variation.VariationSpecifics?.NameValueList || []
            });
          }
        } else {
          // Regular item without variations
          processedListings.push({
            itemId: item.ItemID,
            title: item.Title,
            sku: item.SKU,
            currentPrice: parseFloat(item.SellingStatus?.CurrentPrice || 0),
            quantity: parseInt(item.Quantity || 0, 10),
            currency: item.SellingStatus?.CurrentPrice?.['@currencyID'] || 'USD',
            hasVariations: false,
            listingType: item.ListingType,
            lastModified: item.ReviseStatus?.ItemRevised || item.StartTime
          });
        }
      }
      
      return processedListings.filter(item => item.itemId && item.sku);
    } else {
      throw new Error(`eBay API Error: ${JSON.stringify(sellingResponse.Errors)}`);
    }

  } catch (error) {
    console.error('Error fetching active listings:', error);
    throw error;
  }
}

/**
 * Process individual listing for sync
 */
async function processListing(listing, syncType, forceUpdate, dryRun) {
  try {
    // Step 1: Get updated data from your source (now includes SKU)
    const updatedData = await getUpdatedListingData(listing.itemId, listing.sku);
    
    if (!updatedData) {
      return {
        success: true,
        skipped: true,
        message: 'No updated data available',
        changes: []
      };
    }

    // Step 2: Compare and detect changes
    const changes = detectChanges(listing, updatedData, syncType);
    
    if (changes.length === 0 && !forceUpdate) {
      return {
        success: true,
        skipped: true,
        message: 'No changes detected',
        changes: []
      };
    }

    // Step 3: If dry run, just return what would be changed
    if (dryRun) {
      return {
        success: true,
        skipped: false,
        message: `DRY RUN: Would update ${changes.length} field(s)`,
        changes: changes
      };
    }

    // Step 4: Apply updates to eBay
    const updateResult = await applyUpdates(listing, updatedData, changes);
    
    return {
      success: updateResult.success,
      skipped: false,
      message: updateResult.message,
      changes: changes,
      error: updateResult.error
    };

  } catch (error) {
    return {
      success: false,
      skipped: false,
      message: 'Processing failed',
      changes: [],
      error: error.message
    };
  }
}

/**
 * Get updated listing data from your data source
 */
async function getUpdatedListingData(itemId, sku = null) {
  try {
    console.log(`item id =>  ${itemId} sku => ${sku}`)
    const authToken = process.env.AUTH_TOKEN;
    
    // Get current item data from eBay
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
      
      // If SKU is provided and item has variations, find the specific variation
      let specificVariation = null;
      if (sku && item.Variations && item.Variations.Variation) {
        const variations = Array.isArray(item.Variations.Variation) 
          ? item.Variations.Variation 
          : [item.Variations.Variation];
        
        specificVariation = variations.find(v => v.SKU === sku);
      }
      
      return {
        price: specificVariation ? specificVariation.StartPrice : item.StartPrice,
        quantity: specificVariation ? specificVariation.Quantity : item.Quantity,
        title: item.Title,
        description: item.Description,
        condition: item.ConditionDisplayName,
        category: item.PrimaryCategory,
        sku: sku,
        itemId: itemId
      };
    } else {
      throw new Error(JSON.stringify(getItemResponse.Errors));
    }

  } catch (error) {
    console.error(`Error getting eBay data for ${itemId}${sku ? ` (SKU: ${sku})` : ''}:`, error);
    return null;
  }
}

/**
 * Detect what has changed between current and updated data
 */
function detectChanges(current, updated, syncType) {
  const changes = [];

  if (syncType === 'all' || syncType === 'price') {
    if (updated.price && Math.abs(current.currentPrice - updated.price) > 0.01) {
      changes.push({
        field: 'price',
        from: current.currentPrice,
        to: updated.price,
        change: updated.price - current.currentPrice
      });
    }
  }

  if (syncType === 'all' || syncType === 'inventory') {
    if (updated.quantity !== undefined && current.quantity !== updated.quantity) {
      changes.push({
        field: 'quantity',
        from: current.quantity,
        to: updated.quantity,
        change: updated.quantity - current.quantity
      });
    }
  }

  if (syncType === 'all' || syncType === 'title') {
    if (updated.title && updated.title !== current.title) {
      changes.push({
        field: 'title',
        from: current.title.substring(0, 30) + '...',
        to: updated.title.substring(0, 30) + '...',
        change: 'Title updated'
      });
    }
  }

  if (syncType === 'all' || syncType === 'description') {
    if (updated.description) {
      changes.push({
        field: 'description',
        from: 'Current description',
        to: 'Updated description',
        change: 'Description updated'
      });
    }
  }

  return changes;
}

/**
 * Apply updates to eBay listing
 */
async function applyUpdates(listing, updatedData, changes) {
  try {
    const authToken = process.env.AUTH_TOKEN;

    // Build XML based on changes needed
    let updateXML = '';
    
    changes.forEach(change => {
      switch (change.field) {
        case 'price':
          updateXML += `<StartPrice>${updatedData.price}</StartPrice>`;
          break;
        case 'quantity':
          updateXML += `<Quantity>${updatedData.quantity}</Quantity>`;
          break;
        case 'title':
          updateXML += `<Title><![CDATA[${updatedData.title}]]></Title>`;
          break;
        case 'description':
          updateXML += `<Description><![CDATA[${updatedData.description}]]></Description>`;
          break;
      }
    });

    if (!updateXML) {
      return {
        success: true,
        message: 'No updates needed'
      };
    }

    // For variation listings OR when we have an SKU, always use ReviseInventoryStatus
    // For regular listings without SKU, use ReviseItem
    const useInventoryAPI = listing.hasVariations || listing.sku;
    
    if (useInventoryAPI) {
      // Use ReviseInventoryStatus for variation listings or items with SKU
      const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <InventoryStatus>
    <ItemID>${listing.itemId}</ItemID>
    <SKU>${listing.sku}</SKU>
    ${updatedData.price ? `<StartPrice>${updatedData.price}</StartPrice>` : ''}
    ${updatedData.quantity !== undefined ? `<Quantity>${updatedData.quantity}</Quantity>` : ''}
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;

      const response = await axios({
        method: 'POST',
        url: process.env.NODE_ENV === 'development' 
          ? 'https://api.ebay.com/ws/api.dll' 
          : 'https://api.sandbox.ebay.com/ws/api.dll',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'X-EBAY-API-CALL-NAME': 'ReviseInventoryStatus',
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

      const updateResponse = result.ReviseInventoryStatusResponse;
      
      if (updateResponse.Ack === 'Success' || updateResponse.Ack === 'Warning') {
        // If we need to update title/description, make a separate ReviseItem call
        const needsDescriptionUpdate = changes.some(c => c.field === 'title' || c.field === 'description');
        
        if (needsDescriptionUpdate) {
          await updateItemDescription(listing, updatedData, changes);
        }
        
        return {
          success: true,
          message: `Updated ${changes.length} field(s) successfully`
        };
      } else {
        throw new Error(JSON.stringify(updateResponse.Errors));
      }

    } else {
      // Use ReviseItem for regular listings without variations
      const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <ItemID>${listing.itemId}</ItemID>
    ${updateXML}
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

      const updateResponse = result.ReviseItemResponse;
      
      if (updateResponse.Ack === 'Success' || updateResponse.Ack === 'Warning') {
        return {
          success: true,
          message: `Updated ${changes.length} field(s) successfully`
        };
      } else {
        throw new Error(JSON.stringify(updateResponse.Errors));
      }
    }

  } catch (error) {
    console.error(`Error applying updates to ${listing.itemId}${listing.sku ? ` (SKU: ${listing.sku})` : ''}:`, error);
    return {
      success: false,
      message: 'Failed to apply updates',
      error: error.message
    };
  }
}

/**
 * Helper function to update item description/title for variation listings
 */
async function updateItemDescription(listing, updatedData, changes) {
  try {
    const authToken = process.env.AUTH_TOKEN;
    
    const descriptionChanges = changes.filter(c => c.field === 'title' || c.field === 'description');
    if (descriptionChanges.length === 0) return;
    
    let updateXML = '';
    descriptionChanges.forEach(change => {
      if (change.field === 'title') {
        updateXML += `<Title><![CDATA[${updatedData.title}]]></Title>`;
      } else if (change.field === 'description') {
        updateXML += `<Description><![CDATA[${updatedData.description}]]></Description>`;
      }
    });
    
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <ItemID>${listing.itemId}</ItemID>
    ${updateXML}
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

    return true;
  } catch (error) {
    console.error('Error updating description/title:', error);
    return false;
  }
}

/**
 * Utility function for delays
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Save sync history to database (optional)
 */
async function saveSyncHistory(syncResults) {
  try {
    // TODO: Implement based on your database
    // Example:
    /*
    const db = await getDatabase();
    await db.collection('sync_history').insertOne({
      ...syncResults,
      createdAt: new Date()
    });
    */
    
    console.log('📊 Sync history saved');
    return true;
  } catch (error) {
    console.error('Error saving sync history:', error);
    return false;
  }
}

export default triggerAutoSync;