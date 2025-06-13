// services/strategyService.js

import PricingStrategy from '../models/PricingStrategy.js';
import mongoose from 'mongoose';

/**
 * Create a new pricing strategy.
 * @param {Object} data
 *   - strategyName:       String (required)
 *   - repricingRule:      String ("MATCH_LOWEST" | "BEAT_LOWEST" | "STAY_ABOVE" | "CUSTOM") (required)
 *   - description:        String (optional)
 *   - beatBy:             String ("AMOUNT" | "PERCENTAGE") (required if repricingRule === "BEAT_LOWEST")
 *   - stayAboveBy:        String ("AMOUNT" | "PERCENTAGE") (required if repricingRule === "STAY_ABOVE")
 *   - value:              Number (required if repricingRule is "BEAT_LOWEST" or "STAY_ABOVE")
 *   - noCompetitionAction:String ("USE_MAX_PRICE" | "KEEP_CURRENT" | "USE_MIN_PRICE") (optional)
 *   - maxPrice:           Number (optional)
 *   - minPrice:           Number (optional)
 *   - isDefault:          Boolean (optional)
 *   - createdBy:          ObjectId of user (optional)
 */
export async function createStrategy(data) {
  const {
    strategyName,
    repricingRule,
    description = null,
    beatBy = null,
    stayAboveBy = null,
    value = null,
    noCompetitionAction = 'USE_MAX_PRICE',
    maxPrice = null,
    minPrice = null,
    isDefault = false,
    createdBy = null,
  } = data;

  // Validation is largely handled by the schema, but check uniqueness here
  const existing = await PricingStrategy.findOne({ strategyName });
  if (existing) {
    throw new Error(`Strategy with name "${strategyName}" already exists`);
  }

  // If isDefault is true, clear any previous default
  if (isDefault) {
    await PricingStrategy.updateMany({ isDefault: true }, { isDefault: false });
  }

  const strategy = new PricingStrategy({
    strategyName,
    displayName: strategyName, // Add displayName field
    repricingRule,
    description,
    beatBy,
    stayAboveBy,
    value,
    noCompetitionAction,
    maxPrice,
    minPrice,
    isDefault,
    createdBy,
  });

  return await strategy.save();
}

/**
 * Get all pricing strategies, optionally filtered by isActive.
 * @param {Boolean|null} isActive - If true/false, filter by that; if null, return all.
 */
export async function getAllStrategies(isActive = null, userId = null) {
  const query = {};

  if (isActive !== null) {
    query.isActive = isActive;
  }

  if (userId) {
    query.createdBy = new mongoose.Types.ObjectId(userId); // Filter by createdBy
  }

  return await PricingStrategy.find(query).sort({ strategyName: 1 });
}

/**
 * Get a single pricing strategy by its Mongo _id or by its strategyId.
 * @param {String} idOrStrategyId
 */
export async function getStrategyById(idOrStrategyId) {
  return await PricingStrategy.findOne({
    $or: [{ _id: idOrStrategyId }, { strategyId: idOrStrategyId }],
  });
}

/**
 * Update a pricing strategy’s fields.
 * @param {String} idOrStrategyId
 * @param {Object} updates
 *   - strategyName, repricingRule, description, beatBy, stayAboveBy, value,
 *     noCompetitionAction, maxPrice, minPrice, isActive, isDefault
 */
export async function updateStrategy(idOrStrategyId, updates) {
  const strategy = await getStrategyById(idOrStrategyId);
  if (!strategy) {
    throw new Error('Pricing strategy not found');
  }

  // If user wants to change the name, ensure no duplicate
  if (updates.strategyName && updates.strategyName !== strategy.strategyName) {
    const conflict = await PricingStrategy.findOne({
      strategyName: updates.strategyName,
      _id: { $ne: strategy._id },
    });
    if (conflict) {
      throw new Error(
        `Strategy with name "${updates.strategyName}" already exists`
      );
    }
    strategy.strategyName = updates.strategyName;
  }

  if (updates.repricingRule) strategy.repricingRule = updates.repricingRule;
  if (updates.description !== undefined)
    strategy.description = updates.description;
  if (updates.beatBy !== undefined) strategy.beatBy = updates.beatBy;
  if (updates.stayAboveBy !== undefined)
    strategy.stayAboveBy = updates.stayAboveBy;
  if (updates.value !== undefined) strategy.value = updates.value;
  if (updates.noCompetitionAction)
    strategy.noCompetitionAction = updates.noCompetitionAction;
  if (updates.maxPrice !== undefined) strategy.maxPrice = updates.maxPrice;
  if (updates.minPrice !== undefined) strategy.minPrice = updates.minPrice;
  if (updates.isActive !== undefined) strategy.isActive = updates.isActive;

  if (updates.isDefault === true) {
    // Clear previous default
    await PricingStrategy.updateMany({ isDefault: true }, { isDefault: false });
    strategy.isDefault = true;
  } else if (updates.isDefault === false) {
    strategy.isDefault = false;
  }

  return await strategy.save();
}

/**
 * Delete a pricing strategy. Will fail if strategy.appliesTo is non-empty.
 * @param {String} idOrStrategyId
 */
export async function deleteStrategy(idOrStrategyId) {
  const strategy = await getStrategyById(idOrStrategyId);
  if (!strategy) {
    throw new Error('Pricing strategy not found');
  }
  if (strategy.appliesTo && strategy.appliesTo.length > 0) {
    throw new Error(
      'Cannot delete a strategy that is applied to one or more items'
    );
  }
  return await strategy.remove();
}

/**
 * Apply a strategy to multiple items at once.
 * @param {String} idOrStrategyId
 * @param {Array<Object>} items
 *   Each item object must have:
 *     - itemId: String (required)
 *     - sku:    String or null
 *     - title:  String or null
 *
 * Returns an array of result objects:
 *   { success: Boolean, itemId, sku, message? }
 */
export async function applyStrategyToItems(idOrStrategyId, items) {
  const strategy = await getStrategyById(idOrStrategyId);
  if (!strategy) {
    throw new Error('Pricing strategy not found');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('An array of items to apply strategy to is required');
  }

  const results = [];
  for (const item of items) {
    if (!item.itemId) {
      results.push({
        success: false,
        message: 'Item ID is required',
        itemId: null,
        sku: item.sku || null,
      });
      continue;
    }
    try {
      strategy.appliesTo.push({
        itemId: item.itemId,
        sku: item.sku || null,
        title: item.title || null,
        dateApplied: new Date(),
      });
      results.push({
        success: true,
        itemId: item.itemId,
        sku: item.sku || null,
      });
    } catch (err) {
      results.push({
        success: false,
        message: err.message,
        itemId: item.itemId,
        sku: item.sku || null,
      });
    }
  }

  // Update usageCount + lastUsed
  strategy.usageCount += results.filter((r) => r.success).length;
  strategy.lastUsed = new Date();
  await strategy.save();

  return results;
}

/**
 * Get all strategies that are applied to a specific item (and optional SKU).
 * @param {String} itemId
 * @param {String|null} sku
 */
export async function getStrategiesForItem(itemId, sku = null) {
  if (!itemId) {
    throw new Error('Item ID is required');
  }
  const query = { 'appliesTo.itemId': itemId };
  if (sku) query['appliesTo.sku'] = sku;
  return await PricingStrategy.find(query);
}

/**
 * Remove a strategy’s association with a specific item (and optional SKU).
 * @param {String} idOrStrategyId
 * @param {String} itemId
 * @param {String|null} sku
 *
 * Returns the updated strategy document.
 */
export async function removeStrategyFromItem(
  idOrStrategyId,
  itemId,
  sku = null
) {
  const strategy = await getStrategyById(idOrStrategyId);
  if (!strategy) {
    throw new Error('Pricing strategy not found');
  }

  const initialCount = strategy.appliesTo.length;
  strategy.appliesTo = strategy.appliesTo.filter((entry) => {
    if (entry.itemId !== itemId) return true;
    if (sku && entry.sku !== sku) return true;
    return false;
  });

  const removedCount = initialCount - strategy.appliesTo.length;
  if (removedCount === 0) {
    throw new Error('Item not found in strategy’s applied items');
  }

  await strategy.save();
  return strategy;
}

/**
 * Get all active pricing strategies (isActive === true), sorted by strategyName.
 */
export async function getActiveStrategies() {
  return await PricingStrategy.find({ isActive: true }).sort({
    strategyName: 1,
  });
}

/**
 * Calculate new price based on strategy and competitor price
 * @param {Object} strategy - The pricing strategy
 * @param {Number} competitorPrice - The lowest competitor price
 * @param {Number} currentPrice - Current product price
 */
function calculateNewPrice(strategy, competitorPrice, currentPrice) {
  let newPrice = currentPrice;

  switch (strategy.repricingRule) {
    case 'MATCH_LOWEST':
      newPrice = competitorPrice;
      break;

    case 'BEAT_LOWEST':
      if (strategy.beatBy === 'AMOUNT') {
        newPrice = competitorPrice - strategy.value;
      } else if (strategy.beatBy === 'PERCENTAGE') {
        newPrice = competitorPrice * (1 - strategy.value);
      }
      break;

    case 'STAY_ABOVE':
      if (strategy.stayAboveBy === 'AMOUNT') {
        newPrice = competitorPrice + strategy.value;
      } else if (strategy.stayAboveBy === 'PERCENTAGE') {
        newPrice = competitorPrice * (1 + strategy.value);
      }
      break;

    default:
      newPrice = currentPrice;
  }

  // Apply min/max price constraints
  if (strategy.minPrice && newPrice < strategy.minPrice) {
    newPrice = strategy.minPrice;
  }
  if (strategy.maxPrice && newPrice > strategy.maxPrice) {
    newPrice = strategy.maxPrice;
  }

  return Math.round(newPrice * 100) / 100; // Round to 2 decimal places
}

/**
 * Get current eBay price for an item
 * @param {String} itemId
 */
async function getCurrentEbayPrice(itemId) {
  try {
    const { getCurrentEbayPrice: getRealPrice } = await import(
      './inventoryService.js'
    );
    const result = await getRealPrice(itemId);

    if (result.success && result.price) {
      
      return result.price;
    } else {
      
      // FIX: Return null instead of hardcoded fallback
      return null;
    }
  } catch (error) {
    console.error(`Error getting current eBay price for ${itemId}:`, error);
    // FIX: Return null instead of hardcoded fallback
    return null;
  }
}

/**
 * Update eBay listing price using direct eBay API
 * @param {String} itemId
 * @param {Number} newPrice
 */
async function updateEbayPrice(itemId, newPrice) {
  try {
    

    // Get the item's SKU from real eBay listings
    const { getActiveListings } = await import('./inventoryService.js');
    const response = await getActiveListings();

    let itemSku = 'PART123'; // Default SKU
    if (response.success && response.data.GetMyeBaySellingResponse) {
      const itemArray =
        response.data.GetMyeBaySellingResponse.ActiveList?.ItemArray;
      let items = [];

      if (Array.isArray(itemArray?.Item)) {
        items = itemArray.Item;
      } else if (itemArray?.Item) {
        items = [itemArray.Item];
      }

      const item = items.find((i) => i.ItemID === itemId);
      if (item && item.SKU) {
        itemSku = item.SKU;
        
      }
    }

    // Use the direct eBay update function
    const { updateEbayPrice: directUpdatePrice } = await import(
      './inventoryService.js'
    );
    const result = await directUpdatePrice(itemId, itemSku, newPrice, null);

    if (result.success) {
      

      // Trigger automatic sync for other items with same competitor products
      setTimeout(() => {
        triggerRelatedItemSync(itemId);
      }, 2000);

      return result;
    } else {
      
      return result;
    }
  } catch (error) {
    console.error(`Error updating eBay price for ${itemId}:`, error);
    return {
      success: false,
      error: error.message,
      itemId,
      newPrice,
    };
  }
}

/**
 * Trigger sync for related items when competitor prices change
 * @param {String} changedItemId - The item that triggered the change
 */
async function triggerRelatedItemSync(changedItemId) {
  try {
    

    // Get all active strategies
    const activeStrategies = await PricingStrategy.find({
      isActive: true,
      'appliesTo.0': { $exists: true },
    });

    // Find items that might be affected by competitor price changes
    const itemsToSync = [];

    for (const strategy of activeStrategies) {
      for (const appliedItem of strategy.appliesTo) {
        if (appliedItem.itemId !== changedItemId) {
          itemsToSync.push(appliedItem.itemId);
        }
      }
    }

    // Remove duplicates
    const uniqueItems = [...new Set(itemsToSync)];

    

    // Sync each item (with delay to avoid rate limiting)
    for (let i = 0; i < uniqueItems.length; i++) {
      setTimeout(async () => {
        try {
          await executeStrategiesForItem(uniqueItems[i]);
          
        } catch (error) {
          console.error(`❌ Error auto-syncing item ${uniqueItems[i]}:`, error);
        }
      }, i * 3000); // 3 second delay between each sync
    }
  } catch (error) {
    console.error('Error triggering related item sync:', error);
  }
}

/**
 * Record strategy execution in history
 * @param {String} strategyId
 * @param {String} itemId
 * @param {Object} executionData
 */
async function recordStrategyExecution(strategyId, itemId, executionData) {
  try {
    const strategy = await getStrategyById(strategyId);
    if (strategy) {
      strategy.executionHistory.push({
        timestamp: executionData.timestamp,
        itemId: itemId,
        details: executionData,
        success: true,
      });

      // Keep only last 100 executions to prevent database bloat
      if (strategy.executionHistory.length > 100) {
        strategy.executionHistory = strategy.executionHistory.slice(-100);
      }

      await strategy.save();
    }
  } catch (error) {
    console.error('Error recording strategy execution:', error);
  }
}

/**
 * Apply pricing logic to update product prices based on strategy
 * @param {String} itemId - The product item ID
 * @param {Object} strategy - The applied strategy
 */
async function executePricingStrategy(itemId, strategy) {
  try {
    

    // Get current competitor price - fix the import
    const { getCompetitorPrice } = await import('./inventoryService.js');
    const competitorData = await getCompetitorPrice(itemId);

    

    if (!competitorData.success || !competitorData.price) {
      

      // Handle no competition scenario
      let newPrice;
      switch (strategy.noCompetitionAction) {
        case 'USE_MAX_PRICE':
          newPrice = strategy.maxPrice;
          break;
        case 'USE_MIN_PRICE':
          newPrice = strategy.minPrice;
          break;
        case 'KEEP_CURRENT':
        default:
          
          return {
            success: false,
            reason: 'No competitor data, keeping current price',
          };
      }

      if (newPrice) {
        const updateResult = await updateEbayPrice(itemId, newPrice);
        return updateResult;
      }
      return { success: false, reason: 'No valid price to set' };
    }

    // Parse competitor price (remove USD prefix if present)
    let competitorPrice;
    if (typeof competitorData.price === 'string') {
      competitorPrice = parseFloat(competitorData.price.replace('USD', ''));
    } else {
      competitorPrice = parseFloat(competitorData.price);
    }

    

    // Get current eBay price for this item
    const currentPrice = await getCurrentEbayPrice(itemId);
    if (!currentPrice) {
      
      return { success: false, reason: 'Could not get current price' };
    }

    

    // Calculate new price based on strategy
    const newPrice = calculateNewPrice(strategy, competitorPrice, currentPrice);

    

    // Update the price
    const updateResult = await updateEbayPrice(itemId, newPrice);

    if (updateResult.success) {
      // Record the execution in strategy history
      await recordStrategyExecution(strategy._id, itemId, {
        oldPrice: currentPrice,
        newPrice: newPrice,
        competitorPrice: competitorPrice,
        timestamp: new Date(),
      });

      
      return {
        success: true,
        oldPrice: currentPrice,
        newPrice,
        competitorPrice,
      };
    } else {
      
      return { success: false, reason: updateResult.error };
    }
  } catch (error) {
    console.error(
      `Error executing pricing strategy for item ${itemId}:`,
      error
    );
    return { success: false, reason: error.message };
  }
}

/**
 * Execute all active strategies for competitor price monitoring
 * This should be called periodically (e.g., every hour)
 */
export async function executeAllActiveStrategies() {
  try {
    

    // Get all active strategies
    const activeStrategies = await PricingStrategy.find({
      isActive: true,
      'appliesTo.0': { $exists: true }, // Only strategies that are applied to items
    });

    const results = {
      totalStrategies: activeStrategies.length,
      totalItems: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      errors: [],
    };

    for (const strategy of activeStrategies) {
      

      for (const appliedItem of strategy.appliesTo) {
        results.totalItems++;

        try {
          const updateResult = await executePricingStrategy(
            appliedItem.itemId,
            strategy
          );
          if (updateResult.success) {
            results.successfulUpdates++;
          } else {
            results.failedUpdates++;
            results.errors.push({
              itemId: appliedItem.itemId,
              error: updateResult.reason,
            });
          }
        } catch (error) {
          results.failedUpdates++;
          results.errors.push({
            itemId: appliedItem.itemId,
            error: error.message,
          });
        }
      }
    }

    
    return results;
  } catch (error) {
    console.error('Error executing strategies:', error);
    throw error;
  }
}

/**
 * Execute strategies for a specific item using the proven editProduct method
 */
export async function executeStrategiesForItem(itemId, userId = null) {
  try {
    

    // Get all strategies for this item
    const strategies = await getStrategiesForItem(itemId);

    if (!strategies || strategies.length === 0) {
      
      return {
        success: false,
        message: `No strategies found for item ${itemId}`,
        results: [],
      };
    }

    

    const results = [];

    // Execute each strategy
    for (const strategy of strategies) {
      try {
        

        // FIX: Ensure min/max prices are properly passed to the strategy execution
        const strategyData = {
          strategyName: strategy.strategyName,
          repricingRule: strategy.repricingRule,
          beatBy: strategy.beatBy,
          stayAboveBy: strategy.stayAboveBy,
          value: strategy.value,
          minPrice: strategy.minPrice, // ✅ Make sure this is included
          maxPrice: strategy.maxPrice, // ✅ Make sure this is included
          noCompetitionAction: strategy.noCompetitionAction,
        };

        

        // Get userId from strategy if not provided
        const executionUserId = userId || strategy.createdBy;

        if (!executionUserId) {
          
          results.push({
            success: false,
            itemId,
            strategyName: strategy.strategyName,
            error: 'No userId found for execution',
          });
          continue;
        }

        // FIX: Import the function properly using default export
        const editProductModule = await import('./editProduct.js');
        const updatePriceViaStrategy =
          editProductModule.default.updatePriceViaStrategy;

        if (!updatePriceViaStrategy) {
          console.error(
            `❌ updatePriceViaStrategy function not found in editProduct module`
          );
          results.push({
            success: false,
            itemId,
            strategyName: strategy.strategyName,
            error: 'updatePriceViaStrategy function not available',
          });
          continue;
        }

        const result = await updatePriceViaStrategy(
          itemId,
          strategyData,
          executionUserId
        );

        

        results.push({
          success: result.success,
          itemId,
          strategyName: strategy.strategyName,
          oldPrice: result.oldPrice,
          newPrice: result.newPrice,
          priceUpdated: result.priceUpdated,
          message: result.message,
          constraintApplied: result.constraintApplied,
        });
      } catch (strategyError) {
        console.error(
          `❌ Error executing strategy ${strategy.strategyName}:`,
          strategyError
        );
        results.push({
          success: false,
          itemId,
          strategyName: strategy.strategyName,
          error: strategyError.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return {
      success: successCount > 0,
      message: `Executed ${successCount}/${strategies.length} strategies for item ${itemId}`,
      results,
    };
  } catch (error) {
    console.error(`❌ Error executing strategies for item ${itemId}:`, error);
    return {
      success: false,
      message: `Error executing strategies: ${error.message}`,
      results: [],
    };
  }
}

/**
 * Remove an item from all strategies to avoid duplicates
 * @param {String} itemId
 * @param {String|null} sku
 */
async function removeItemFromAllStrategies(itemId, sku = null) {
  try {
    const strategiesWithItem = await PricingStrategy.find({
      'appliesTo.itemId': itemId,
    });

    for (const strategy of strategiesWithItem) {
      strategy.appliesTo = strategy.appliesTo.filter((entry) => {
        if (entry.itemId !== itemId) return true;
        if (sku && entry.sku !== sku) return true;
        return false;
      });
      await strategy.save();
    }

    
  } catch (error) {
    console.error('Error removing item from all strategies:', error);
  }
}

/**
 * Get strategy display information for a product
 * @param {String} itemId
 * @param {String|null} sku
 */
export async function getStrategyDisplayForProduct(itemId, sku = null) {
  try {
    const strategies = await getStrategiesForItem(itemId, sku);

    if (!strategies || strategies.length === 0) {
      
      return {
        strategy: 'Assign Strategy',
        minPrice: 'Set',
        maxPrice: 'Set',
        hasStrategy: false,
      };
    }

    // Use the most recently applied strategy (sort by dateApplied)
    let mostRecentStrategy = strategies[0];
    let mostRecentDate = new Date(0);

    for (const strategy of strategies) {
      const appliedEntry = strategy.appliesTo.find(
        (entry) =>
          entry.itemId === itemId && (sku === null || entry.sku === sku)
      );
      if (appliedEntry && new Date(appliedEntry.dateApplied) > mostRecentDate) {
        mostRecentStrategy = strategy;
        mostRecentDate = new Date(appliedEntry.dateApplied);
      }
    }

    const strategy = mostRecentStrategy;
    

    let strategyDisplay = strategy.strategyName;
    if (strategy.value) {
      strategyDisplay += ` (${strategy.value}`;
      if (
        strategy.beatBy === 'PERCENTAGE' ||
        strategy.stayAboveBy === 'PERCENTAGE'
      ) {
        strategyDisplay += '%)';
      } else {
        strategyDisplay += ')';
      }
    }

    return {
      strategy: strategyDisplay,
      minPrice: strategy.minPrice
        ? `USD${parseFloat(strategy.minPrice).toFixed(2)}`
        : 'Set',
      maxPrice: strategy.maxPrice
        ? `USD${parseFloat(strategy.maxPrice).toFixed(2)}`
        : 'Set',
      hasStrategy: true,
      strategyData: strategy,
    };
  } catch (error) {
    console.error('Error getting strategy display for product:', error);
    return {
      strategy: 'Error',
      minPrice: 'Set',
      maxPrice: 'Set',
      hasStrategy: false,
    };
  }
}

/**
 * Apply multiple strategies to a single product/item.
 * @param {String} itemId
 * @param {Array<String>} strategyIds
 * @param {String|null} sku
 */
export async function applyStrategiesToProduct(
  itemId,
  strategyIds,
  sku = null
) {
  if (!itemId) {
    throw new Error('Item ID is required');
  }
  if (!Array.isArray(strategyIds) || strategyIds.length === 0) {
    throw new Error('Strategy IDs array is required');
  }

  // First, remove the item from all existing strategies to avoid duplicates
  await removeItemFromAllStrategies(itemId, sku);

  const results = [];
  for (const strategyId of strategyIds) {
    try {
      const strategy = await getStrategyById(strategyId);
      if (!strategy) {
        results.push({
          strategyId,
          success: false,
          error: 'Strategy not found',
        });
        continue;
      }

      strategy.appliesTo.push({
        itemId,
        sku,
        title: null,
        dateApplied: new Date(),
      });

      strategy.usageCount += 1;
      strategy.lastUsed = new Date();
      await strategy.save();

      

      // FIX: Don't execute pricing strategy immediately here since we'll do it after all strategies are applied
      results.push({
        strategyId,
        success: true,
        strategyName: strategy.strategyName,
        repricingRule: strategy.repricingRule,
        minPrice: strategy.minPrice,
        maxPrice: strategy.maxPrice,
        message: `Strategy ${strategy.strategyName} applied successfully`,
      });
    } catch (error) {
      results.push({
        strategyId,
        success: false,
        error: error.message,
      });
    }
  }

   => r.success).length
    } strategies to item ${itemId}`
  );
  return results;
}
