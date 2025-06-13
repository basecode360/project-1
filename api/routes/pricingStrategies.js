// routes/pricingStrategyRoutes.js

import express from 'express';
import { requireAuth } from '../controllers/middleware/authMiddleware.js';
import {
  createStrategy,
  getAllStrategies,
  getStrategyById,
  updateStrategy,
  deleteStrategy,
  applyStrategyToItems,
  getStrategiesForItem,
  removeStrategyFromItem,
  getActiveStrategies,
  applyStrategiesToProduct,
} from '../services/strategyService.js';

const router = express.Router();

// 1) Create a new strategy
//    POST /api/pricing-strategies
router.post('/', requireAuth, async (req, res) => {
  try {


    const strategy = await createStrategy({
      ...req.body,
      createdBy: req.user.id,
    });
    return res.status(201).json({ success: true, data: strategy });
  } catch (err) {
    console.error('Error in POST /api/pricing-strategies:', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

// 2) Get all strategies (optional: ?active=true|false)
//    GET /api/pricing-strategies
router.get('/', requireAuth, async (req, res) => {
  try {
    const { active } = req.query;
    let isActive = null;
    if (active === 'true') isActive = true;
    else if (active === 'false') isActive = false;

    const strategies = await getAllStrategies(isActive);
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
router.get('/active-listings', requireAuth, async (req, res) => {
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
router.get('/active', requireAuth, async (req, res) => {
  try {
    const strategies = await getActiveStrategies();
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
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const strategy = await getStrategyById(req.params.id);
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
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const updated = await updateStrategy(req.params.id, req.body);
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
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await deleteStrategy(req.params.id);
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
router.post('/:id/apply', requireAuth, async (req, res) => {
  try {
    const items = req.body.items; // should be [{ itemId, sku?, title? }, …]
    const results = await applyStrategyToItems(req.params.id, items);
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

// 6.5) Apply strategies to a specific product/item
//      POST /api/pricing-strategies/products/:itemId
router.post('/products/:itemId', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { strategyIds, sku = null } = req.body;

    if (
      !strategyIds ||
      !Array.isArray(strategyIds) ||
      strategyIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'strategyIds array is required',
      });
    }

    // Apply strategies using the proven editProduct method
    const results = await applyStrategiesToProduct(itemId, strategyIds, sku);
    const successCount = results.filter((r) => r.success).length;

    // After applying strategies, immediately execute them to update prices
    if (successCount > 0) {
   
      const { executeStrategiesForItem } = await import(
        '../services/strategyService.js'
      );
      const executeResult = await executeStrategiesForItem(itemId);

      if (executeResult.success) {
        return res.json({
          success: true,
          message: `Applied ${successCount} strategies and updated price for item ${itemId}`,
          results: results.concat(executeResult.results || []),
          priceUpdated: true,
        });
      }
    }

    return res.json({
      success: true,
      message: `Applied ${successCount} of ${strategyIds.length} strategies to item ${itemId}`,
      results,
    });
  } catch (err) {
    console.error('Error applying strategies to product:', err);
    return res.status(400).json({ success: false, message: err.message });
  }
});

// 6.7) Update/Apply strategy to a specific product/item (PUT method)
//      PUT /api/pricing-strategies/products/:itemId
router.put('/products/:itemId', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const strategyData = req.body;

    // If the request contains a strategy ID, apply it to the product
    if (strategyData._id || strategyData.strategyId) {
      const strategyId = strategyData._id || strategyData.strategyId;
      const results = await applyStrategiesToProduct(
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
      const results = await applyStrategiesToProduct(
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
router.get('/products/:itemId/display', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { sku = null } = req.query;

    const { getStrategyDisplayForProduct } = await import(
      '../services/strategyService.js'
    );
    const displayInfo = await getStrategyDisplayForProduct(itemId, sku);

    return res.json({
      success: true,
      data: displayInfo,
    });
  } catch (err) {
    console.error('Error in GET /products/:itemId/display:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 6.6) Get strategies applied to a specific product (MOVE THIS AFTER THE DISPLAY ROUTE)
//      GET /api/pricing-strategies/products/:itemId
router.get('/products/:itemId', requireAuth, async (req, res) => {
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
router.get('/item/:itemId', requireAuth, async (req, res) => {
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
router.delete('/:id/item/:itemId', requireAuth, async (req, res) => {
  try {
    const { sku = null } = req.query;
    await removeStrategyFromItem(req.params.id, req.params.itemId, sku);
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
router.post('/execute-all', requireAuth, async (req, res) => {
  try {
    const { executeAllStrategiesController } = await import(
      '../controllers/pricingStrategyController.js'
    );
    return executeAllStrategiesController(req, res);
  } catch (err) {
    console.error('Error in POST /execute-all:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 6.10) Execute strategies for a specific item
//       POST /api/pricing-strategies/products/:itemId/execute
router.post('/products/:itemId/execute', requireAuth, async (req, res) => {
  try {
    const { executeStrategiesForItemController } = await import(
      '../controllers/pricingStrategyController.js'
    );
    return executeStrategiesForItemController(req, res);
  } catch (err) {
    console.error('Error in POST /products/:itemId/execute:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 6.11) Force price update for a specific item
//       POST /api/pricing-strategies/products/:itemId/update-price
router.post('/products/:itemId/update-price', requireAuth, async (req, res) => {
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
    const { executeStrategiesForItem } = await import(
      '../services/strategyService.js'
    );
    const result = await executeStrategiesForItem(itemId);

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

export default router;
