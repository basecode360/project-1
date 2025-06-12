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
    console.log(
      'POST /api/pricing-strategies - User:',
      req.user?.id || 'No user'
    );
    console.log(
      'POST /api/pricing-strategies - Headers:',
      req.headers.authorization ? 'Auth header present' : 'No auth header'
    );

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
    const isActive = active === 'true';

    const strategies = await getAllStrategies(isActive, userId);
    return res.status(200).json({
      success: true,
      strategies, // Wrap strategies in the specified format
      rules: [], // Placeholder for rulesData if applicable
    });
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

    const results = await applyStrategiesToProduct(itemId, strategyIds, sku);
    const successCount = results.filter((r) => r.success).length;

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

// 6.6) Get strategies applied to a specific product
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

export default router;
