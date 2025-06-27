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

  // Handle beatBy and stayAboveBy - only set if not empty string
  if (updates.beatBy !== undefined) {
    strategy.beatBy =
      updates.beatBy && updates.beatBy.trim() !== '' ? updates.beatBy : null;
  }
  if (updates.stayAboveBy !== undefined) {
    strategy.stayAboveBy =
      updates.stayAboveBy && updates.stayAboveBy.trim() !== ''
        ? updates.stayAboveBy
        : null;
  }

  if (updates.value !== undefined) strategy.value = updates.value;
  if (updates.noCompetitionAction)
    strategy.noCompetitionAction = updates.noCompetitionAction;

  // Handle min/max prices properly
  if (updates.minPrice !== undefined) {
    strategy.minPrice =
      updates.minPrice !== null && updates.minPrice !== ''
        ? parseFloat(updates.minPrice)
        : null;
  }
  if (updates.maxPrice !== undefined) {
    strategy.maxPrice =
      updates.maxPrice !== null && updates.maxPrice !== ''
        ? parseFloat(updates.maxPrice)
        : null;
  }

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
 * @param {Object} strategy - The pricing strategy from MongoDB
 * @param {Number} competitorPrice - The lowest competitor price
 * @param {Number} currentPrice - Current product price
 */
function calculateNewPrice(strategy, competitorPrice, currentPrice) {
  let newPrice = currentPrice;

  // Handle case where no competitor price is available
  if (!competitorPrice || competitorPrice <= 0) {
    switch (strategy.noCompetitionAction) {
      case 'USE_MAX_PRICE':
        return strategy.maxPrice || currentPrice;
      case 'USE_MIN_PRICE':
        return strategy.minPrice || currentPrice;
      case 'KEEP_CURRENT':
      default:
        return currentPrice;
    }
  }

  // Use the actual strategy configuration from MongoDB
  switch (strategy.repricingRule) {
    case 'MATCH_LOWEST':
      newPrice = competitorPrice;
      break;

    case 'BEAT_LOWEST':
      if (strategy.beatBy === 'AMOUNT') {
        newPrice = competitorPrice - (strategy.value || 0);
      } else if (strategy.beatBy === 'PERCENTAGE') {
        const discountAmount = competitorPrice * (strategy.value || 0);
        newPrice = competitorPrice - discountAmount;
      }
      break;

    case 'STAY_ABOVE':
      if (strategy.stayAboveBy === 'AMOUNT') {
        newPrice = competitorPrice + (strategy.value || 0);
      } else if (strategy.stayAboveBy === 'PERCENTAGE') {
        const markupAmount = competitorPrice * (strategy.value || 0);
        newPrice = competitorPrice + markupAmount;
      }
      break;

    default:
      console.warn(`Unknown repricing rule: ${strategy.repricingRule}`);
      newPrice = currentPrice;
  }

  // Apply min/max price constraints from the strategy
  if (strategy.minPrice && newPrice < strategy.minPrice) {
    console.log(
      `🔼 Price ${newPrice} below minimum ${strategy.minPrice}, adjusting to minimum`
    );
    newPrice = strategy.minPrice;
  }
  if (strategy.maxPrice && newPrice > strategy.maxPrice) {
    console.log(
      `🔽 Price ${newPrice} above maximum ${strategy.maxPrice}, adjusting to maximum`
    );
    newPrice = strategy.maxPrice;
  }

  // Enhanced logic for STAY_ABOVE strategy with max price optimization
  if (strategy.repricingRule === 'STAY_ABOVE' && strategy.maxPrice) {
    const calculatedPrice =
      strategy.stayAboveBy === 'AMOUNT'
        ? competitorPrice + (strategy.value || 0)
        : competitorPrice + competitorPrice * (strategy.value || 0);

    // If calculated price is significantly lower than max price, use max price
    if (strategy.maxPrice - calculatedPrice >= 2) {
      console.log(
        `💡 Using max price ${strategy.maxPrice} instead of calculated ${calculatedPrice} (gap >= $2)`
      );
      newPrice = strategy.maxPrice;
    }
  }

  // Ensure price is positive
  if (newPrice <= 0) {
    console.warn(
      `Calculated price ${newPrice} is not positive, keeping current price`
    );
    newPrice = currentPrice;
  }

  return Math.round(newPrice * 100) / 100; // Round to 2 decimal places
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

    // Also record in PriceHistory collection for the table
    try {
      const { default: PriceHistory } = await import(
        '../models/PriceHistory.js'
      );

      // Only record if we have valid price data
      if (
        executionData.newPrice !== null &&
        executionData.newPrice !== undefined
      ) {
        const historyRecord = {
          itemId: itemId,
          sku: executionData.sku || null,
          oldPrice: executionData.oldPrice || 0,
          newPrice: executionData.newPrice,
          competitorPrice: executionData.competitorPrice,
          competitorLowestPrice: executionData.competitorPrice, // Add this field for compatibility
          strategyName: strategy.strategyName,
          repricingRule: strategy.repricingRule,
          minPrice: strategy.minPrice,
          maxPrice: strategy.maxPrice,
          userId: strategy.createdBy,
          source: 'strategy', // Use valid enum value
          status: 'completed',
          success: executionData.success !== false, // Default to true unless explicitly false
          timestamp: executionData.timestamp || new Date(),
          date: executionData.timestamp || new Date(), // Add date field for compatibility
          reason: 'Strategy execution',
          apiResponse: executionData.apiResponse || null,
        };

        console.log('💾 Recording price history:', historyRecord);
        await new PriceHistory(historyRecord).save();
      } else {
        console.log('⚠️ Skipping price history record - no valid price data');
      }
    } catch (historyError) {
      console.warn('Failed to record price history:', historyError);
    }
  } catch (error) {
    console.error('Failed to record strategy execution:', error);
  }
}

/**
 * Get current eBay price for an item
 * @param {String} itemId
 */
async function getCurrentEbayPrice(itemId) {
  try {
    // Use dynamic import to avoid module conflicts
    const inventoryModule = await import('./inventoryService.js');
    const { getActiveListings } = inventoryModule;

    // Try to get user ID from various sources
    const userId = process.env.DEFAULT_USER_ID || '68430c2b0e746fb6c6ef1a7a';

    const response = await getActiveListings(userId);

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
      if (item && item.BuyItNowPrice) {
        return parseFloat(item.BuyItNowPrice);
      }
    }

    console.warn(`Item ${itemId} not found in eBay listings`);
    return null;
  } catch (error) {
    console.error(`Error getting current eBay price for ${itemId}:`, error);
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
    // Get user ID from environment or find the first user with eBay credentials
    const userId = process.env.DEFAULT_USER_ID || '68430c2b0e746fb6c6ef1a7a';

    // Get the item's SKU first
    const inventoryModule = await import('./inventoryService.js');
    const { getActiveListings, updateEbayPrice: directUpdatePrice } =
      inventoryModule;

    const response = await getActiveListings(userId);

    let itemSku = itemId; // Use itemId as fallback SKU
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

    // Use the inventory service to update the price
    const result = await directUpdatePrice(itemId, itemSku, newPrice, userId);

    if (result.success) {
      console.log(
        `✅ Successfully updated eBay price for ${itemId} to ${newPrice}`
      );

      // Trigger related item sync after a delay
      setTimeout(() => {
        triggerRelatedItemSync(itemId);
      }, 2000);

      return result;
    } else {
      console.error(
        `❌ Failed to update eBay price for ${itemId}:`,
        result.error
      );
      return result;
    }
  } catch (error) {
    console.error(`❌ Error updating eBay price for ${itemId}:`, error);
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
    const activeStrategies = await PricingStrategy.find({
      isActive: true,
      'appliesTo.0': { $exists: true },
    });

    const itemsToSync = [];

    for (const strategy of activeStrategies) {
      for (const appliedItem of strategy.appliesTo) {
        if (appliedItem.itemId !== changedItemId) {
          itemsToSync.push(appliedItem.itemId);
        }
      }
    }

    const uniqueItems = [...new Set(itemsToSync)];

    // Sync each item (with delay to avoid rate limiting)
    for (let i = 0; i < uniqueItems.length; i++) {
      setTimeout(async () => {
        try {
          await executeStrategiesForItem(uniqueItems[i]);
        } catch (error) {
          // Handle error silently
        }
      }, i * 3000); // 3 second delay between each sync
    }
  } catch (error) {
    // Handle error silently
  }
}

/**
 * Apply pricing logic to update product prices based on strategy
 * @param {String} itemId - The product item ID
 * @param {Object} strategy - The applied strategy from MongoDB
 */
async function executePricingStrategy(itemId, strategy) {
  try {
    console.log(`🔄 Executing pricing strategy for item ${itemId}:`, {
      strategyName: strategy.strategyName,
      repricingRule: strategy.repricingRule,
      value: strategy.value,
      beatBy: strategy.beatBy,
      stayAboveBy: strategy.stayAboveBy,
      minPrice: strategy.minPrice,
      maxPrice: strategy.maxPrice,
      noCompetitionAction: strategy.noCompetitionAction,
    });

    // Get current competitor price
    const inventoryModule = await import('./inventoryService.js');
    const { getCompetitorPrice } = inventoryModule;

    const competitorData = await getCompetitorPrice(itemId);

    let competitorPrice = null;
    if (competitorData.success && competitorData.price) {
      // Parse competitor price (remove USD prefix if present)
      if (typeof competitorData.price === 'string') {
        competitorPrice = parseFloat(
          competitorData.price.replace(/[^0-9.]/g, '')
        );
      } else {
        competitorPrice = parseFloat(competitorData.price);
      }
      console.log(`📊 Competitor price found: ${competitorPrice}`);
    } else {
      console.log(`⚠️ No competitor data found for ${itemId}`);
    }

    // Get current eBay price for this item
    const currentPrice = await getCurrentEbayPrice(itemId);

    // If we can't get current price, try a different approach
    if (!currentPrice) {
      console.error(`❌ Could not get current price for item ${itemId}`);

      // If we have competitor price and strategy constraints, we can still calculate and update
      if (competitorPrice && strategy) {
        console.log(`🔄 Attempting direct price update for ${itemId}`);

        // Calculate new price based on strategy configuration from MongoDB
        const calculatedPrice = calculateNewPrice(
          strategy,
          competitorPrice,
          competitorPrice // Use competitor price as fallback current price
        );
        console.log(
          `🎯 Calculated price using strategy "${strategy.strategyName}": ${calculatedPrice}`
        );

        // Attempt to update the price directly
        const updateResult = await updateEbayPrice(itemId, calculatedPrice);

        if (updateResult.success) {
          console.log(
            `✅ Successfully updated price for ${itemId} to ${calculatedPrice} using strategy "${strategy.strategyName}"`
          );

          // Record the execution in strategy history
          await recordStrategyExecution(strategy._id, itemId, {
            oldPrice: null,
            newPrice: calculatedPrice,
            competitorPrice: competitorPrice,
            timestamp: new Date(),
            success: true,
            sku: null,
            apiResponse: updateResult,
          });

          return {
            success: true,
            oldPrice: null,
            newPrice: calculatedPrice,
            competitorPrice,
            priceChanged: true,
            updateDetails: updateResult,
            calculatedFromCompetitor: true,
            strategyUsed: strategy.strategyName,
          };
        } else {
          console.error(
            `❌ Failed to update price for ${itemId}:`,
            updateResult.error
          );

          return {
            success: false,
            reason: updateResult.error,
            oldPrice: null,
            calculatedPrice: calculatedPrice,
            competitorPrice,
            strategyUsed: strategy.strategyName,
          };
        }
      }

      return {
        success: false,
        reason: 'Could not get current price and no competitor data available',
        strategyUsed: strategy.strategyName,
      };
    }

    console.log(`💰 Current eBay price: ${currentPrice}`);

    // Calculate new price based on strategy configuration from MongoDB
    const newPrice = calculateNewPrice(strategy, competitorPrice, currentPrice);
    console.log(
      `🎯 Calculated new price using strategy "${strategy.strategyName}": ${newPrice}`
    );

    // Check if price actually needs to change
    if (Math.abs(newPrice - currentPrice) < 0.01) {
      console.log(`✅ Price already optimal for ${itemId}: ${currentPrice}`);

      // Still record this as a successful execution (no change needed)
      await recordStrategyExecution(strategy._id, itemId, {
        oldPrice: currentPrice,
        newPrice: currentPrice,
        competitorPrice: competitorPrice,
        timestamp: new Date(),
        success: true,
        sku: null,
        apiResponse: null,
      });

      return {
        success: true,
        reason: 'Price already optimal',
        oldPrice: currentPrice,
        newPrice: currentPrice,
        competitorPrice,
        priceChanged: false,
        strategyUsed: strategy.strategyName,
      };
    }

    // Update the price
    console.log(
      `🔄 Updating price for ${itemId} from ${currentPrice} to ${newPrice} using strategy "${strategy.strategyName}"`
    );
    const updateResult = await updateEbayPrice(itemId, newPrice);

    if (updateResult.success) {
      // Record the execution in strategy history
      await recordStrategyExecution(strategy._id, itemId, {
        oldPrice: currentPrice,
        newPrice: newPrice,
        competitorPrice: competitorPrice,
        timestamp: new Date(),
        success: true,
        sku: null,
        apiResponse: updateResult,
      });

      console.log(
        `✅ Successfully executed strategy "${strategy.strategyName}" for ${itemId}`
      );
      return {
        success: true,
        oldPrice: currentPrice,
        newPrice,
        competitorPrice,
        priceChanged: true,
        updateDetails: updateResult,
        strategyUsed: strategy.strategyName,
      };
    } else {
      console.error(
        `❌ Failed to update price for ${itemId}:`,
        updateResult.error
      );

      return {
        success: false,
        reason: updateResult.error,
        oldPrice: currentPrice,
        calculatedPrice: newPrice,
        competitorPrice,
        strategyUsed: strategy.strategyName,
      };
    }
  } catch (error) {
    console.error(`❌ Error executing pricing strategy for ${itemId}:`, error);

    return {
      success: false,
      reason: error.message,
      strategyUsed: strategy?.strategyName || 'Unknown',
    };
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
    throw error;
  }
}

/**
 * Execute strategies for a specific item using the proven editProduct method
 */
export async function executeStrategiesForItem(itemId, userId = null) {
  try {
    console.log(`🚀 Starting strategy execution for item ${itemId}`);

    // Get all strategies for this item
    const strategies = await getStrategiesForItem(itemId);

    if (!strategies || strategies.length === 0) {
      console.log(`⚠️ No strategies found for item ${itemId}`);

      // Check if there are no competitors - if so, apply max price if strategy exists
      try {
        const inventoryModule = await import('./inventoryService.js');
        const { getCompetitorPrice } = inventoryModule;

        const competitorData = await getCompetitorPrice(itemId);

        if (!competitorData.success || !competitorData.price) {
          console.log(
            `📊 No competitors found for ${itemId}, checking for strategies to apply max price`
          );

          // Even without explicit strategies, we should check price history for applied strategies
          try {
            const { default: PriceHistory } = await import(
              '../models/PriceHistory.js'
            );

            const latestRecord = await PriceHistory.findOne({
              itemId: itemId,
              strategyName: { $exists: true, $ne: null },
            })
              .sort({ createdAt: -1 })
              .lean();

            if (latestRecord && latestRecord.maxPrice) {
              console.log(
                `🔄 Found strategy in history, applying max price: ${latestRecord.maxPrice}`
              );

              const updateResult = await updateEbayPrice(
                itemId,
                latestRecord.maxPrice
              );

              if (updateResult.success) {
                return {
                  success: true,
                  message: `Applied max price ${latestRecord.maxPrice} for item ${itemId} (no competition)`,
                  results: [
                    {
                      success: true,
                      itemId,
                      strategyName: latestRecord.strategyName,
                      oldPrice: null,
                      newPrice: latestRecord.maxPrice,
                      reason: 'No competition - applied max price',
                      priceChanged: true,
                    },
                  ],
                  totalStrategies: 1,
                  successfulExecutions: 1,
                  priceChanges: 1,
                };
              }
            }
          } catch (historyError) {
            console.error('Error checking price history:', historyError);
          }
        }
      } catch (competitorError) {
        console.error('Error checking competitors:', competitorError);
      }

      return {
        success: false,
        message: `No strategies found for item ${itemId}`,
        results: [],
      };
    }

    console.log(`📋 Found ${strategies.length} strategies for item ${itemId}`);
    const results = [];

    // Execute each strategy (usually there should be only one)
    for (const strategy of strategies) {
      try {
        console.log(`🔄 Executing strategy: ${strategy.strategyName}`);

        const executionResult = await executePricingStrategy(itemId, strategy);

        results.push({
          success: executionResult.success,
          itemId,
          strategyName: strategy.strategyName,
          repricingRule: strategy.repricingRule,
          oldPrice: executionResult.oldPrice,
          newPrice: executionResult.newPrice,
          competitorPrice: executionResult.competitorPrice,
          priceChanged: executionResult.priceChanged,
          reason: executionResult.reason,
          constraintApplied: executionResult.constraintApplied,
          error: executionResult.success ? null : executionResult.reason,
        });
      } catch (error) {
        console.error('Error executing strategy:', error);
        results.push({
          success: false,
          itemId,
          strategyName: strategy.strategyName,
          error: error.message,
        });
      }
    }

    const successfulExecutions = results.filter((r) => r.success).length;
    const priceChanges = results.filter(
      (r) => r.success && r.priceChanged
    ).length;

    return {
      success: true,
      message: `Executed ${results.length} strategies for item ${itemId}`,
      results,
      totalStrategies: strategies.length,
      successfulExecutions,
      priceChanges,
    };
  } catch (error) {
    console.error('Error executing strategies for item:', error);
    return {
      success: false,
      message: error.message,
      results: [],
    };
  }
}

/**
 * Remove an item from all strategies that it's currently applied to
 * @param {String} itemId
 * @param {String|null} sku
 */
async function removeItemFromAllStrategies(itemId, sku = null) {
  try {
    const strategies = await PricingStrategy.find({
      'appliesTo.itemId': itemId,
    });

    for (const strategy of strategies) {
      strategy.appliesTo = strategy.appliesTo.filter((entry) => {
        if (entry.itemId !== itemId) return true;
        if (sku && entry.sku !== sku) return true;
        return false;
      });
      await strategy.save();
    }
  } catch (error) {
    console.error('Error removing item from strategies:', error);
  }
}

/**
 * Apply multiple strategies to a single item
 * @param {String} itemId
 * @param {Array<String>} strategyIds
 * @param {String|null} sku
 */
export async function applyStrategiesToItem(itemId, strategyIds, sku = null) {
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

  return results;
}

/**
 * Get display information for a product's pricing strategy
 * @param {String} itemId
 * @param {String|null} sku
 */
export async function getStrategyDisplayForProduct(itemId, sku = null) {
  try {
    console.log(
      `🔍 Getting strategy display for product ${itemId}${
        sku ? ` with SKU ${sku}` : ''
      }`
    );

    // Get strategies applied to this item
    const strategies = await getStrategiesForItem(itemId, sku);

    if (!strategies || strategies.length === 0) {
      console.log(`⚠️ No strategies found for item ${itemId}`);
      return {
        strategy: 'Assign Strategy',
        minPrice: 'Set',
        maxPrice: 'Set',
        hasStrategy: false,
        appliedStrategies: [],
        strategyCount: 0,
      };
    }

    // Use the first (most recent) strategy
    const primaryStrategy = strategies[0];

    console.log(`✅ Found strategy for ${itemId}:`, {
      strategyName: primaryStrategy.strategyName,
      repricingRule: primaryStrategy.repricingRule,
      minPrice: primaryStrategy.minPrice,
      maxPrice: primaryStrategy.maxPrice,
      value: primaryStrategy.value,
      beatBy: primaryStrategy.beatBy,
      stayAboveBy: primaryStrategy.stayAboveBy,
    });

    return {
      strategy: primaryStrategy.strategyName, // Just use the actual strategy name
      minPrice: primaryStrategy.minPrice
        ? `$${primaryStrategy.minPrice.toFixed(2)}`
        : 'Set',
      maxPrice: primaryStrategy.maxPrice
        ? `$${primaryStrategy.maxPrice.toFixed(2)}`
        : 'Set',
      hasStrategy: true,
      appliedStrategies: strategies,
      strategyCount: strategies.length,
      repricingRule: primaryStrategy.repricingRule,
      strategyName: primaryStrategy.strategyName, // Keep original name for reference
      value: primaryStrategy.value,
      beatBy: primaryStrategy.beatBy,
      stayAboveBy: primaryStrategy.stayAboveBy,
      rawStrategy: primaryStrategy, // Include the full strategy object for debugging
    };
  } catch (error) {
    console.error(`❌ Error getting strategy display for ${itemId}:`, error);
    return {
      strategy: 'Assign Strategy',
      minPrice: 'Set',
      maxPrice: 'Set',
      hasStrategy: false,
      appliedStrategies: [],
      strategyCount: 0,
      error: error.message,
    };
  }
}
