// routes/pricingStrategyRoutes.js

import express from 'express';
import {
  createPricingStrategy,
  getAllPricingStrategies,
  getPricingStrategy,
  updatePricingStrategy,
  deletePricingStrategy,
  applyStrategyToItemsController,
  getStrategiesForItemController,
  removeStrategyFromItemController,
  getActivePricingStrategies,
  getStrategyDisplayForProductController,
  executeAllStrategiesController,
  setStrategyForItemController,
  executeStrategyForItemController,
} from '../controllers/pricingStrategyController.js';
import PricingStrategy from '../models/PricingStrategy.js';
import {
  getStrategiesForItem,
  executeStrategyForItem,
  applyStrategiesToItem,
} from '../services/strategyService.js';
import Product from '../models/Product.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(requireAuth);
// 1) Create a new strategy WITHOUT applying it to any listing
//    POST /api/pricing-strategies
router.post('/', async (req, res) => {
  try {
    const strategy = await createPricingStrategy({
      ...req.body,
      createdBy: req.user.id,
    });

    return res.status(201).json({
      success: true,
      data: strategy,
      message: `Strategy "${strategy.strategyName}" created successfully. You can now apply it to specific listings.`,
    });
  } catch (err) {
    console.error('Error in POST /api/pricing-strategies:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

// 2) Get all strategies (optional: ?active=true|false)
//    GET /api/pricing-strategies
router.get('/', async (req, res) => {
  try {
    const { active } = req.query;
    let isActive = null;
    if (active === 'true') isActive = true;
    else if (active === 'false') isActive = false;

    const strategies = await getAllPricingStrategies(isActive);
    return res.status(200).json({
      success: true,
      strategies, // Wrap strategies in the specified format
      rules: [], // Placeholder for rulesData if applicable
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 2.5) Get active listings with strategies
//      GET /api/pricing-strategies/active-listings
router.get('/active-listings', async (req, res) => {
  try {
    const { userId, active } = req.query;

    // Set the userId in req for the controller to use
    if (userId) {
      req.userId = userId;
    }

    // Call the controller function instead of service directly
    const { getAllPricingStrategies } = await import(
      '../controllers/pricingStrategyController.js'
    );
    return getAllPricingStrategies(req, res);
  } catch (err) {
    console.error('Error in GET /active-listings:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 2.6) Get all "active" strategies only
//      GET /api/pricing-strategies/active
router.get('/active', async (req, res) => {
  try {
    const strategies = await getActivePricingStrategies();
    return res.status(200).json({
      success: true,
      strategies, // Wrap strategies in the specified format
      rules: [], // Placeholder for rulesData if applicable
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 3) Get a single strategy by ID or strategyId
//    GET /api/pricing-strategies/:id
router.get('/:id', async (req, res) => {
  try {
    const strategy = await getPricingStrategy(req.params.id);
    if (!strategy) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    return res.json({ success: true, data: strategy });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 4) Update a strategy
//    PUT /api/pricing-strategies/:id
router.put('/:id', async (req, res) => {
  try {
    const updated = await updatePricingStrategy(req.params.id, req.body);
    return res.json({ success: true, data: updated });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ success: false, message: err.message });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
});

// 5) Delete a strategy (only if it has no appliesTo[] entries)
//    DELETE /api/pricing-strategies/:id
router.delete('/:id', async (req, res) => {
  try {
    await deletePricingStrategy(req.params.id);
    return res.json({ success: true, message: 'Deleted successfully' });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ success: false, message: err.message });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
});

// 6) Apply a strategy to multiple items
//    POST /api/pricing-strategies/:id/apply
router.post('/:id/apply', async (req, res) => {
  try {
    const items = req.body.items; // should be [{ itemId, sku?, title? }, …]
    const results = await applyStrategyToItemsController(req.params.id, items);
    return res.json({
      success: true,
      message: `Applied to ${results.filter((r) => r.success).length} item(s)`,
      results,
    });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ success: false, message: err.message });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
});

// 6.7) Update/Apply strategy to a specific product/item (PUT method)
//      PUT /api/pricing-strategies/products/:itemId
router.put('/products/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const strategyData = req.body;

    // If the request contains a strategy ID, apply it to the product
    if (strategyData._id || strategyData.strategyId) {
      const strategyId = strategyData._id || strategyData.strategyId;
      const results = await applyStrategiesToItem(
        // Fixed function name
        itemId,
        [strategyId],
        null
      );

      return res.json({
        success: true,
        message: `Strategy applied to item ${itemId}`,
        results,
      });
    }

    // If strategyIds array is provided, apply multiple strategies
    if (strategyData.strategyIds && Array.isArray(strategyData.strategyIds)) {
      const results = await applyStrategiesToItem(
        // Fixed function name
        itemId,
        strategyData.strategyIds,
        strategyData.sku || null
      );
      const successCount = results.filter((r) => r.success).length;

      return res.json({
        success: true,
        message: `Applied ${successCount} of ${strategyData.strategyIds.length} strategies to item ${itemId}`,
        results,
      });
    }

    return res.status(400).json({
      success: false,
      message: 'Strategy ID or strategyIds array is required',
    });
  } catch (err) {
    console.error('Error updating strategies for product:', err);
    return res.status(400).json({ success: false, message: err.message });
  }
});

// 6.8) Get strategy display information for a product (MOVE THIS BEFORE THE GENERAL GET)
//      GET /api/pricing-strategies/products/:itemId/display
router.get('/products/:itemId/display', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { sku = null } = req.query;

    const { getStrategyDisplayForProduct } = await import(
      '../services/strategyService.js'
    );
    const displayInfo = await getStrategyDisplayForProduct(itemId, sku);

    // Add cache control headers to prevent caching
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });

    return res.json({
      success: true,
      data: displayInfo,
    });
  } catch (err) {
    console.error('Error in GET /products/:itemId/display:', err.message);
    return res.status(500).json({
      success: false,
      message: err.message,
      data: {
        strategy: 'Assign Strategy',
        minPrice: 'Set',
        maxPrice: 'Set',
        hasStrategy: false,
        appliedStrategies: [],
        strategyCount: 0,
      },
    });
  }
});

// 6.12) Get applied strategy from MongoDB price history
//       GET /api/pricing-strategies/products/:itemId/mongo-strategy
router.get('/products/:itemId/mongo-strategy', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { userId } = req.query;

    // Import PriceHistory model
    const { default: PriceHistory } = await import('../models/PriceHistory.js');

    // Find the most recent price history record with a strategy for this item
    const latestRecord = await PriceHistory.findOne({
      itemId: itemId,
      strategyName: { $exists: true, $ne: null },
      ...(userId && { userId: userId }),
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!latestRecord) {
      return res.json({
        success: false,
        message: 'No strategy found in price history for this item',
        data: null,
      });
    }

    // Get the strategy details from the strategy collection
    const { getStrategyById } = await import('../services/strategyService.js');

    // Try to find the strategy by name first
    const { default: PricingStrategy } = await import(
      '../models/PricingStrategy.js'
    );
    const strategy = await PricingStrategy.findOne({
      strategyName: latestRecord.strategyName,
    }).lean();

    if (strategy) {
      return res.json({
        success: true,
        data: {
          strategyName: strategy.strategyName,
          minPrice: strategy.minPrice,
          maxPrice: strategy.maxPrice,
          repricingRule: strategy.repricingRule,
          appliedAt: latestRecord.createdAt,
          lastExecutedPrice: latestRecord.newPrice,
          competitorPrice: latestRecord.competitorLowestPrice,
        },
      });
    } else {
      // Return basic info from price history if strategy not found in collection
      return res.json({
        success: true,
        data: {
          strategyName: latestRecord.strategyName,
          minPrice: null,
          maxPrice: null,
          appliedAt: latestRecord.createdAt,
          lastExecutedPrice: latestRecord.newPrice,
          competitorPrice: latestRecord.competitorLowestPrice,
        },
      });
    }
  } catch (err) {
    console.error(
      'Error in GET /products/:itemId/mongo-strategy:',
      err.message
    );
    return res.status(500).json({
      success: false,
      message: err.message,
      data: null,
    });
  }
});

// 6.6) Get strategies applied to a specific product (MOVE THIS AFTER THE MONGO-STRATEGY ROUTE)
//      GET /api/pricing-strategies/products/:itemId
router.get('/products/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { sku = null } = req.query;
    const strategies = await getStrategiesForItem(itemId, sku);
    return res.json({
      success: true,
      count: strategies.length,
      data: strategies,
    });
  } catch (err) {
    console.error('Error in GET /products/:itemId:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 7) Get strategies that apply to a single item
//    GET /api/pricing-strategies/item/:itemId?sku=<optional>
router.get('/item/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { sku = null } = req.query;
    const strategies = await getStrategiesForItem(itemId, sku);
    return res.json({
      success: true,
      count: strategies.length,
      data: strategies,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// 8) Remove a strategy from a specific item (and optional SKU)
//    DELETE /api/pricing-strategies/:id/item/:itemId?sku=<optional>
router.delete('/:id/item/:itemId', async (req, res) => {
  try {
    const { sku = null } = req.query;
    await removeStrategyFromItemController(
      req.params.id,
      req.params.itemId,
      sku
    );
    return res.json({
      success: true,
      message: `Removed strategy from item ${req.params.itemId}`,
    });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ success: false, message: err.message });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
});

// 6.9) Execute all active strategies manually
//      POST /api/pricing-strategies/execute-all
router.post('/execute-all', executeAllStrategiesController);

// 6.11) Force price update for a specific item
//       POST /api/pricing-strategies/products/:itemId/update-price
router.post('/products/:itemId/update-price', async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.user?.id;

    // Get strategies for this item
    const strategies = await getStrategiesForItem(itemId);

    if (!strategies || strategies.length === 0) {
      return res.json({
        success: false,
        message: 'No strategies found for this item',
      });
    }

    // Execute the most recent strategy
    const { executeStrategyForItem } = await import(
      '../services/strategyService.js'
    );
    const result = await executeStrategyForItem(itemId);

    // Also try to get competitor price for logging
    try {
      const { getCompetitorPrice } = await import(
        '../services/inventoryService.js'
      );
      const competitorData = await getCompetitorPrice(itemId);

      if (competitorData.success && competitorData.price) {
        const competitorPrice = parseFloat(
          competitorData.price.replace('USD', '')
        );
        const strategy = strategies[0]; // Use first strategy

        let calculatedPrice = competitorPrice;
        if (strategy.repricingRule === 'MATCH_LOWEST') {
          calculatedPrice = competitorPrice;
        }

        // Apply min/max constraints
        if (strategy.minPrice && calculatedPrice < strategy.minPrice) {
          calculatedPrice = strategy.minPrice;
        }
        if (strategy.maxPrice && calculatedPrice > strategy.maxPrice) {
          calculatedPrice = strategy.maxPrice;
        }
      }
    } catch (competitorError) {
      console.error('Error getting competitor price:', competitorError.message);
    }

    return res.json({
      success: true,
      message: `Price update completed for item ${itemId}`,
      data: result,
    });
  } catch (err) {
    console.error('Error in POST /products/:itemId/update-price:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/products/:itemId/apply', async (req, res) => {
  try {
    const { itemId } = req.params;
    const {
      strategyId,
      strategyIds,
      minPrice = null,
      maxPrice = null,
      sku = null,
      title = null,
    } = req.body;

    // 1) Normalize incoming strategy IDs
    const ids = strategyIds?.length
      ? strategyIds
      : strategyId
      ? [strategyId]
      : [];

    if (!ids.length) {
      return res.status(400).json({
        success: false,
        message: 'Provide either strategyId or strategyIds array',
      });
    }

    // 2) Verify each strategy exists
    const found = await PricingStrategy.find({ _id: { $in: ids } });
    if (found.length !== ids.length) {
      return res.status(404).json({
        success: false,
        message: 'One or more strategy IDs not found',
      });
    }

    // 3) Associate these strategy IDs to the item (no min/max here)
    const applyResults = await applyStrategiesToItem(itemId, ids, sku);

    // 4) Upsert listing-level overrides on Product
    const ebayAccountId =
      req.user?.ebayAccountId || process.env.DEFAULT_EBAY_ACCOUNT_ID;
    const userId = req.user?._id || req.body.userId;
    const updated = await Product.findOneAndUpdate(
      { itemId, ebayAccountId },
      {
        $setOnInsert: { itemId, title, sku, userId, ebayAccountId },
        $set: {
          minPrice: minPrice != null ? +minPrice : null,
          maxPrice: maxPrice != null ? +maxPrice : null,
        },
      },
      { upsert: true, new: true }
    );

    // 5) Immediately execute those strategies on eBay
    const execResult = await executeStrategyForItem(itemId, userId);

    // 6) Respond
    return res.json({
      success: true,
      message: `Applied ${
        applyResults.filter((r) => r.success).length
      } strategy(ies) and executed price update`,
      applyResults,
      executionResults: execResult.results || [],
      priceUpdated: execResult.priceChanges > 0,
      listingOverrides: {
        itemId: updated.itemId,
        minPrice: updated.minPrice,
        maxPrice: updated.maxPrice,
      },
    });
  } catch (err) {
    console.error('Error in /products/:itemId/apply:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/products/:itemId/strategy', setStrategyForItemController);

router.post('/products/:itemId/execute', async (req, res) => {
  const result = await executeStrategyForItem(req.params.itemId);
  res.json(result);
});

router.post('/products/:itemId/execute', executeStrategyForItemController);
export default router;
