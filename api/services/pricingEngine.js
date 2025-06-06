// services/pricingEngine.js

import { getItemDetails } from './itemService.js';
import { fetchCompetitorPrices } from './competitorPriceService.js';
import User from '../models/Users.js';

/**
 * Example pricing rules. In practice, you’d read these from Mongo (e.g. via a Strategy schema).
 * For demonstration, here are three simple rule types:
 *
 *  1. "matchLowest": Set price = lowest competitor price
 *  2. "beatByAmount": Set price = (lowest competitor price) - X
 *  3. "stayAbovePercent": Set price = max( (lowest competitor price) * (1 + PERCENT), MIN_PRICE )
 *
 * Each rule object should include:
 *   - type: one of "matchLowest" | "beatByAmount" | "stayAbovePercent"
 *   - params: an object, e.g. { amount: 0.50 } or { percent: 0.10, minPrice: 5.00 }
 */
const RULE_TYPES = {
  matchLowest: async ({ lowestPrice }) => {
    return lowestPrice;
  },

  beatByAmount: async ({ lowestPrice, params }) => {
    const { amount } = params;
    return Math.max(lowestPrice - amount, 0);
  },

  stayAbovePercent: async ({ lowestPrice, params }) => {
    const { percent, minPrice } = params;
    const target = lowestPrice * (1 + percent);
    return Math.max(target, minPrice || 0);
  },
};

/**
 * Main function: apply a single pricing rule to one item.
 *
 * @param {String} userId      – ID of the logged‐in user
 * @param {String} itemId      – eBay item ID to reprice
 * @param {Object} strategy    – a strategy object with fields:
 *                                { type: "matchLowest"|"beatByAmount"|"stayAbovePercent",
 *                                  params: { … } }
 *
 * @returns {Object} {
 *   itemId,
 *   currentPrice: Number,
 *   lowestCompetitorPrice: Number,
 *   newPrice: Number,
 *   shouldUpdate: Boolean
 * }
 */
export async function applyPricingRule(userId, itemId, strategy) {
  // 1) Fetch full item details (including current price, title, category)
  const item = await getItemDetails(userId, itemId);
  const currentPrice = Number(item.price.value || 0);
  const title = item.title;
  const categoryId = item.category.id;

  // 2) Fetch competitor prices via Browse API
  const { lowestPrice: lowestCompetitorPrice } = await fetchCompetitorPrices(
    userId,
    itemId,
    title,
    categoryId
  );

  // 3) Calculate new price based on the rule type and params
  const ruleFn = RULE_TYPES[strategy.type];
  if (!ruleFn) {
    throw new Error(`Unknown pricing rule type: ${strategy.type}`);
  }

  const newPriceRaw = await ruleFn({
    lowestPrice: lowestCompetitorPrice,
    params: strategy.params || {},
  });

  // 4) Round to two decimals (eBay requires valid currency formats)
  const newPrice = Number(newPriceRaw.toFixed(2));

  // 5) Decide whether to update: only if newPrice differs from currentPrice
  const shouldUpdate = newPrice !== currentPrice;

  return {
    itemId,
    currentPrice,
    lowestCompetitorPrice,
    newPrice,
    shouldUpdate,
  };
}

/**
 * Batch‐apply pricing rules to all active listings for a user.
 *
 * @param {String} userId                – ID of the logged‐in user
 * @param {Function} fetchActiveListings – function(userId) ⇒ [ { itemId }, … ]
 * @param {Function} updatePriceFn       – function(userId, itemId, newPrice) ⇒ Promise
 * @param {Array<Object>} strategies     – array of strategy objects:
 *                                          [ { itemId, strategy }, … ]
 *                                        (each strategy = { type, params })
 *
 * This function will:
 *   1) For each listing, look up its corresponding strategy (by itemId).
 *   2) Call applyPricingRule(...) to compute newPrice.
 *   3) If shouldUpdate, call updatePriceFn(userId, itemId, newPrice).
 *   4) Return a summary of changes.
 */
export async function runAutoSync(
  userId,
  fetchActiveListings,
  updatePriceFn,
  strategies
) {
  // 1) Retrieve all active listings for the user
  const listings = await fetchActiveListings(userId);
  const results = [];

  // 2) Loop through each listing
  for (const listing of listings) {
    const itemId = listing.ItemID || listing.itemId;
    // Find strategy for this item
    const stratEntry = strategies.find((s) => s.itemId === itemId);
    if (!stratEntry) {
      // No rule defined for this item
      results.push({
        itemId,
        skipped: true,
        reason: 'No strategy defined',
      });
      continue;
    }

    try {
      // 3) Compute pricing decision
      const { currentPrice, lowestCompetitorPrice, newPrice, shouldUpdate } =
        await applyPricingRule(userId, itemId, stratEntry.strategy);

      if (shouldUpdate) {
        // 4) Push update through provided update function
        await updatePriceFn(userId, itemId, newPrice);
        results.push({
          itemId,
          currentPrice,
          lowestCompetitorPrice,
          newPrice,
          updated: true,
        });
      } else {
        results.push({
          itemId,
          currentPrice,
          lowestCompetitorPrice,
          newPrice,
          updated: false,
          reason: 'Price already optimal',
        });
      }
    } catch (err) {
      results.push({
        itemId,
        error: err.message,
      });
    }
  }

  return results;
}
