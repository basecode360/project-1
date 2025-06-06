// controllers/pricingStrategyController.js
import PricingStrategy from "../models/StrategySchema.js";

/**
 * Create a new pricing strategy
 * POST /api/ebay/pricing-strategies
 */

// router.post('/pricing-strategies', createPricingStrategy);
// router.get('/pricing-strategies', getAllPricingStrategies);
// router.get('/pricing-strategies/:id', getPricingStrategy);
// router.put('/pricing-strategies/:id', updatePricingStrategy);
// router.delete('/pricing-strategies/:id', deletePricingStrategy);

// // Strategy application routes
// router.post('/pricing-strategies/:id/apply', applyStrategyToItems);
// router.get('/pricing-strategies/item/:itemId', getStrategiesForItem);
// router.delete('/pricing-strategies/:id/item/:itemId', removeStrategyFromItem);

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

    // Validate required fields
    if (!strategyName || !repricingRule) {
      return res.status(400).json({
        success: false,
        message: "Strategy name and repricing rule are required",
      });
    }

    // Validate strategy-specific required fields
    if (repricingRule === "BEAT_LOWEST" && (!beatBy || value === undefined)) {
      return res.status(400).json({
        success: false,
        message: "BEAT_LOWEST strategy requires beatBy and value fields",
      });
    }

    if (
      repricingRule === "STAY_ABOVE" &&
      (!stayAboveBy || value === undefined)
    ) {
      return res.status(400).json({
        success: false,
        message: "STAY_ABOVE strategy requires stayAboveBy and value fields",
      });
    }

    // Check for duplicate strategy name
    const existingStrategy = await PricingStrategy.findOne({ strategyName });
    if (existingStrategy) {
      return res.status(409).json({
        success: false,
        message: `Strategy with name "${strategyName}" already exists`,
      });
    }

    // Create new strategy
    const strategy = new PricingStrategy({
      strategyName,
      repricingRule,
      description,
      beatBy,
      stayAboveBy,
      value,
      noCompetitionAction,
      maxPrice,
      minPrice,
      createdBy: req.user?._id, // If authentication is implemented
      isDefault: isDefault || false,
    });

    // If this is set as default, unset any existing defaults
    if (isDefault) {
      await PricingStrategy.updateMany(
        { isDefault: true },
        { isDefault: false }
      );
    }

    // Save the strategy
    await strategy.save();

    return res.status(201).json({
      success: true,
      message: "Pricing strategy created successfully",
      data: strategy,
    });
  } catch (error) {
    console.error("Error creating pricing strategy:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating pricing strategy",
      error: error.message,
    });
  }
};

/**
 * Get all pricing strategies
 * GET /api/ebay/pricing-strategies
 */
const getAllPricingStrategies = async (req, res) => {
  try {
    const { active } = req.query;

    const query = {};
    if (active === "true") {
      query.isActive = true;
    } else if (active === "false") {
      query.isActive = false;
    }

    const strategies = await PricingStrategy.find(query).sort({
      strategyName: 1,
    });

    return res.status(200).json({
      success: true,
      count: strategies.length,
      data: strategies,
    });

  } catch (error) {
    console.error("Error fetching pricing strategies:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching pricing strategies",
      error: error.message,
    });
  }
};


/**
 * Get a single pricing strategy
 * GET /api/ebay/pricing-strategies/:id
 */
const getPricingStrategy = async (req, res) => {
  try {
    const { id } = req.params;

    const strategy = await PricingStrategy.findOne({
      $or: [{ _id: id }, { strategyId: id }],
    });

    if (!strategy) {
      return res.status(404).json({
        success: false,
        message: "Pricing strategy not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: strategy,
    });
  } catch (error) {
    console.error("Error fetching pricing strategy:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching pricing strategy",
      error: error.message,
    });
  }
};

/**
 * Update a pricing strategy
 * PUT /api/ebay/pricing-strategies/:id
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

    // Find the strategy
    const strategy = await PricingStrategy.findOne({
      $or: [{ _id: id }, { strategyId: id }],
    });

    if (!strategy) {
      return res.status(404).json({
        success: false,
        message: "Pricing strategy not found",
      });
    }

    // Check for duplicate name (if name is being changed)
    if (strategyName && strategyName !== strategy.strategyName) {
      const existingWithName = await PricingStrategy.findOne({
        strategyName,
        _id: { $ne: strategy._id },
      });

      if (existingWithName) {
        return res.status(409).json({
          success: false,
          message: `Strategy with name "${strategyName}" already exists`,
        });
      }

      strategy.strategyName = strategyName;
    }

    // Update fields if provided
    if (repricingRule) strategy.repricingRule = repricingRule;
    if (description !== undefined) strategy.description = description;
    if (beatBy) strategy.beatBy = beatBy;
    if (stayAboveBy) strategy.stayAboveBy = stayAboveBy;
    if (value !== undefined) strategy.value = value;
    if (noCompetitionAction) strategy.noCompetitionAction = noCompetitionAction;
    if (maxPrice !== undefined) strategy.maxPrice = maxPrice;
    if (minPrice !== undefined) strategy.minPrice = minPrice;
    if (isActive !== undefined) strategy.isActive = isActive;

    // Handle default status
    if (isDefault) {
      // Unset any existing defaults
      await PricingStrategy.updateMany(
        { isDefault: true },
        { isDefault: false }
      );
      strategy.isDefault = true;
    } else if (isDefault === false) {
      strategy.isDefault = false;
    }

    // Save changes
    await strategy.save();

    return res.status(200).json({
      success: true,
      message: "Pricing strategy updated successfully",
      data: strategy,
    });
  } catch (error) {
    console.error("Error updating pricing strategy:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating pricing strategy",
      error: error.message,
    });
  }
};

/**
 * Delete a pricing strategy
 * DELETE /api/ebay/pricing-strategies/:id
 */
const deletePricingStrategy = async (req, res) => {
  try {
    const { id } = req.params;

    const strategy = await PricingStrategy.findOne({
      $or: [{ _id: id }, { strategyId: id }],
    });

    if (!strategy) {
      return res.status(404).json({
        success: false,
        message: "Pricing strategy not found",
      });
    }

    // Check if strategy is in use
    if (strategy.appliesTo && strategy.appliesTo.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete strategy that is applied to items",
        appliedItemCount: strategy.appliesTo.length,
      });
    }

    // Delete the strategy
    await strategy.remove();

    return res.status(200).json({
      success: true,
      message: "Pricing strategy deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting pricing strategy:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting pricing strategy",
      error: error.message,
    });
  }
};

/**
 * Apply a strategy to an item
 * POST /api/ebay/pricing-strategies/:id/apply
 */
const applyStrategyToItems = async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Array of items to apply strategy to is required",
      });
    }

    // Find the strategy
    const strategy = await PricingStrategy.findOne({
      $or: [{ _id: id }, { strategyId: id }],
    });

    if (!strategy) {
      return res.status(404).json({
        success: false,
        message: "Pricing strategy not found",
      });
    }

    // Apply strategy to each item
    const results = [];

    for (const item of items) {
      if (!item.itemId) {
        results.push({
          success: false,
          message: "Item ID is required",
          item,
        });
        continue;
      }

      try {
        // Add item to strategy's appliesTo array
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
      } catch (error) {
        results.push({
          success: false,
          message: error.message,
          itemId: item.itemId,
          sku: item.sku || null,
        });
      }
    }

    // Update usage count
    strategy.usageCount += results.filter((r) => r.success).length;
    strategy.lastUsed = new Date();

    // Save the strategy
    await strategy.save();

    return res.status(200).json({
      success: true,
      message: `Strategy applied to ${
        results.filter((r) => r.success).length
      } items`,
      totalItems: items.length,
      results,
    });
  } catch (error) {
    console.error("Error applying pricing strategy:", error);
    return res.status(500).json({
      success: false,
      message: "Error applying pricing strategy",
      error: error.message,
    });
  }
};

/**
 * Get strategies applied to an item
 * GET /api/ebay/pricing-strategies/item/:itemId
 */
const getStrategiesForItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { sku } = req.query;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        message: "Item ID is required",
      });
    }

    let query = { "appliesTo.itemId": itemId };
    if (sku) {
      query["appliesTo.sku"] = sku;
    }

    const strategies = await PricingStrategy.find(query);

    return res.status(200).json({
      success: true,
      count: strategies.length,
      itemId,
      sku: sku || "all",
      data: strategies,
    });
  } catch (error) {
    console.error("Error fetching strategies for item:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching strategies for item",
      error: error.message,
    });
  }
};

/**
 * Remove a strategy from an item
 * DELETE /api/ebay/pricing-strategies/:id/item/:itemId
 */
const removeStrategyFromItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { sku } = req.query;

    // Find the strategy
    const strategy = await PricingStrategy.findOne({
      $or: [{ _id: id }, { strategyId: id }],
    });

    if (!strategy) {
      return res.status(404).json({
        success: false,
        message: "Pricing strategy not found",
      });
    }

    // Find the item in the appliesTo array
    const query = { itemId };
    if (sku) {
      query.sku = sku;
    }

    const initialCount = strategy.appliesTo.length;

    // Remove matching items
    strategy.appliesTo = strategy.appliesTo.filter((item) => {
      if (item.itemId === itemId) {
        if (sku && item.sku !== sku) {
          return true; // Keep if SKU doesn't match
        }
        return false; // Remove if all criteria match
      }
      return true; // Keep all other items
    });

    const removedCount = initialCount - strategy.appliesTo.length;

    if (removedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Item not found in strategy's applied items",
      });
    }

    // Save the strategy
    await strategy.save();

    return res.status(200).json({
      success: true,
      message: `Strategy removed from ${removedCount} item(s)`,
      itemId,
      sku: sku || "all",
    });
  } catch (error) {
    console.error("Error removing strategy from item:", error);
    return res.status(500).json({
      success: false,
      message: "Error removing strategy from item",
      error: error.message,
    });
  }
};

/**
 * Get all active pricing strategies
 * GET /api/ebay/pricing-strategies/active-listings
 */
const getActivePricingStrategies = async (req, res) => {
  try {
    const strategies = await PricingStrategy.find({ isActive: true }).sort({
      strategyName: 1,
    });

    return res.status(200).json({
      success: true,
      count: strategies.length,
      data: strategies,
    });
  } catch (error) {
    console.error("Error fetching active strategies:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching active strategies",
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
