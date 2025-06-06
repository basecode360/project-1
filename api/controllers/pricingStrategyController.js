// controllers/pricingStrategyController.js

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
} from '../services/strategyService.js';

/**
 * Create a new pricing strategy
 * POST /api/pricing-strategies
 */
const createPricingStrategy = async (req, res) => {
  try {
    const {
      strategyName,
      repricingRule,
      beatBy,
      stayAboveBy,
      value,
      noCompetitionAction,
      maxPrice,
      minPrice,
      description,
      isDefault,
    } = req.body;

    if (!strategyName || !repricingRule) {
      return res.status(400).json({
        success: false,
        message: 'Strategy name and repricing rule are required',
      });
    }

    if (
      repricingRule === 'BEAT_LOWEST' &&
      (beatBy === undefined || value === undefined)
    ) {
      return res.status(400).json({
        success: false,
        message: 'BEAT_LOWEST strategy requires beatBy and value fields',
      });
    }

    if (
      repricingRule === 'STAY_ABOVE' &&
      (stayAboveBy === undefined || value === undefined)
    ) {
      return res.status(400).json({
        success: false,
        message: 'STAY_ABOVE strategy requires stayAboveBy and value fields',
      });
    }

    const strategy = await createStrategy({
      strategyName,
      repricingRule,
      description,
      beatBy,
      stayAboveBy,
      value,
      noCompetitionAction,
      maxPrice,
      minPrice,
      isDefault: isDefault || false,
      createdBy: req.user?._id,
    });

    return res.status(201).json({
      success: true,
      message: 'Pricing strategy created successfully',
      data: strategy,
    });
  } catch (error) {
    console.error('Error creating pricing strategy:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message.includes('already exists')
        ? error.message
        : 'Error creating pricing strategy',
      error: error.message,
    });
  }
};

/**
 * Get all pricing strategies
 * GET /api/pricing-strategies
 */
const getAllPricingStrategies = async (req, res) => {
  try {
    const { active } = req.query;
    let isActive = null;

    if (active === 'true') {
      isActive = true;
    } else if (active === 'false') {
      isActive = false;
    }

    const strategies = await getAllStrategies(isActive);
    return res.status(200).json({
      success: true,
      count: strategies.length,
      data: strategies,
    });
  } catch (error) {
    console.error('Error fetching pricing strategies:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching pricing strategies',
      error: error.message,
    });
  }
};

/**
 * Get a single pricing strategy
 * GET /api/pricing-strategies/:id
 */
const getPricingStrategy = async (req, res) => {
  try {
    const { id } = req.params;
    const strategy = await getStrategyById(id);

    if (!strategy) {
      return res.status(404).json({
        success: false,
        message: 'Pricing strategy not found',
      });
    }
    return res.status(200).json({
      success: true,
      data: strategy,
    });
  } catch (error) {
    console.error('Error fetching pricing strategy:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching pricing strategy',
      error: error.message,
    });
  }
};

/**
 * Update a pricing strategy
 * PUT /api/pricing-strategies/:id
 */
const updatePricingStrategy = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      strategyName,
      repricingRule,
      description,
      beatBy,
      stayAboveBy,
      value,
      noCompetitionAction,
      maxPrice,
      minPrice,
      isActive,
      isDefault,
    } = req.body;

    const strategy = await updateStrategy(id, {
      strategyName,
      repricingRule,
      description,
      beatBy,
      stayAboveBy,
      value,
      noCompetitionAction,
      maxPrice,
      minPrice,
      isActive,
      isDefault,
    });

    return res.status(200).json({
      success: true,
      message: 'Pricing strategy updated successfully',
      data: strategy,
    });
  } catch (error) {
    console.error('Error updating pricing strategy:', error.message);
    const statusCode = error.message.includes('not found')
      ? 404
      : error.message.includes('already exists')
      ? 409
      : 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message,
      error: error.message,
    });
  }
};

/**
 * Delete a pricing strategy
 * DELETE /api/pricing-strategies/:id
 */
const deletePricingStrategy = async (req, res) => {
  try {
    const { id } = req.params;
    await deleteStrategy(id);

    return res.status(200).json({
      success: true,
      message: 'Pricing strategy deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting pricing strategy:', error.message);
    const statusCode = error.message.includes('not found')
      ? 404
      : error.message.includes('applied to')
      ? 400
      : 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message,
      error: error.message,
    });
  }
};

/**
 * Apply a strategy to items
 * POST /api/pricing-strategies/:id/apply
 */
const applyStrategyToItems = async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Array of items to apply strategy to is required',
      });
    }

    const results = await applyStrategyToItems(id, items);

    return res.status(200).json({
      success: true,
      message: `Strategy applied to ${
        results.filter((r) => r.success).length
      } items`,
      totalItems: items.length,
      results,
    });
  } catch (error) {
    console.error('Error applying pricing strategy:', error.message);
    const statusCode = error.message.includes('not found') ? 404 : 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message,
      error: error.message,
    });
  }
};

/**
 * Get strategies applied to an item
 * GET /api/pricing-strategies/item/:itemId
 */
const getStrategiesForItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { sku } = req.query;

    const strategies = await getStrategiesForItem(itemId, sku);

    return res.status(200).json({
      success: true,
      count: strategies.length,
      itemId,
      sku: sku || 'all',
      data: strategies,
    });
  } catch (error) {
    console.error('Error fetching strategies for item:', error.message);
    const statusCode = error.message.includes('required') ? 400 : 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message,
      error: error.message,
    });
  }
};

/**
 * Remove a strategy from an item
 * DELETE /api/pricing-strategies/:id/item/:itemId
 */
const removeStrategyFromItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { sku } = req.query;

    await removeStrategyFromItem(id, itemId, sku);

    return res.status(200).json({
      success: true,
      message: 'Strategy removed from item successfully',
      itemId,
      sku: sku || 'all',
    });
  } catch (error) {
    console.error('Error removing strategy from item:', error.message);
    const statusCode = error.message.includes('not found') ? 404 : 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message,
      error: error.message,
    });
  }
};

/**
 * Get all active pricing strategies
 * GET /api/pricing-strategies/active-listings
 */
const getActivePricingStrategies = async (req, res) => {
  try {
    const strategies = await getActiveStrategies();

    return res.status(200).json({
      success: true,
      count: strategies.length,
      data: strategies,
    });
  } catch (error) {
    console.error('Error fetching active strategies:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching active strategies',
      error: error.message,
    });
  }
};

export {
  createPricingStrategy,
  getAllPricingStrategies,
  getPricingStrategy,
  updatePricingStrategy,
  deletePricingStrategy,
  applyStrategyToItems,
  getStrategiesForItem,
  removeStrategyFromItem,
  getActivePricingStrategies,
};
