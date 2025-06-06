// controllers/competitorRuleController.js
import CompetitorRule from "../models/competitorSchema.js";

/**
 * Create a new competitor rule
 * POST /api/ebay/competitor-rules
 */
const createCompetitorRule = async (req, res) => {
  try {
    const {
      ruleName,
      minPercentOfCurrentPrice,
      maxPercentOfCurrentPrice,
      excludeCountries,
      excludeConditions,
      excludeProductTitleWords,
      excludeSellers,
      findCompetitorsBasedOnMPN,
    } = req.body;

    // Validate required fields
    if (!ruleName) {
      return res.status(400).json({
        success: false,
        message: "Rule name is required",
      });
    }

    // Check for duplicate rule name
    const existingRule = await CompetitorRule.findOne({ ruleName });
    if (existingRule) {
      return res.status(409).json({
        success: false,
        message: `Rule with name "${ruleName}" already exists`,
      });
    }

    // Create new rule
    const competitorRule = new CompetitorRule({
      ruleName,
      // description is not defined in destructuring, so remove or add it if needed
      minPercentOfCurrentPrice:
        minPercentOfCurrentPrice !== undefined ? minPercentOfCurrentPrice : 0,
      maxPercentOfCurrentPrice:
        maxPercentOfCurrentPrice !== undefined
          ? maxPercentOfCurrentPrice
          : 1000,
      excludeCountries: excludeCountries || [],
      excludeConditions: excludeConditions || [],
      excludeProductTitleWords: excludeProductTitleWords || [],
      excludeSellers: excludeSellers || [],
      findCompetitorsBasedOnMPN: findCompetitorsBasedOnMPN || false,
      // createdBy: req.user?._id, // If authentication is implemented
      // isDefault: isDefault || false
    });

    // If this is set as default, unset any existing defaults
    if (isDefault) {
      await CompetitorRule.updateMany(
        { isDefault: true },
        { isDefault: false }
      );
    }

    // Save the rule
    await competitorRule.save();

    return res.status(201).json({
      success: true,
      message: "Competitor rule created successfully",
      data: competitorRule,
    });
  } catch (error) {
    console.error("Error creating competitor rule:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating competitor rule",
      error: error.message,
    });
  }
};

/**
 * Get all competitor rules
 * GET /api/ebay/competitor-rules
 */
const getAllCompetitorRules = async (req, res) => {
  try {
    const { active } = req.query;

    let query = {};
    if (active === "true") {
      query.isActive = true;
    } else if (active === "false") {
      query.isActive = false;
    }

    const rules = await CompetitorRule.find(query).sort({ ruleName: 1 });

    // Always return 200 with an array, even if empty
    return res.status(200).json({
      success: true,
      count: rules.length,
      data: rules,
    });
  } catch (error) {
    // Send error response only if headers haven't been sent
    if (!res.headersSent) {
      console.error("Error fetching competitor rules:", error);
      return res.status(500).json({
        success: false,
        message: "Error fetching competitor rules",
        error: error.message,
      });
    }
    // Otherwise, just log the error
    console.error(
      "Error fetching competitor rules (headers already sent):",
      error
    );
  }
};

/**
 * Get a single competitor rule
 * GET /api/ebay/competitor-rules/:id
 */
const getCompetitorRule = async (req, res) => {
  try {
    const { id } = req.params;

    const rule = await CompetitorRule.findOne({
      $or: [{ _id: id }, { ruleId: id }],
    });

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: "Competitor rule not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: rule,
    });
  } catch (error) {
    console.error("Error fetching competitor rule:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching competitor rule",
      error: error.message,
    });
  }
};

/**
 * Update a competitor rule
 * PUT /api/ebay/competitor-rules/:id
 */
const updateCompetitorRule = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Find the rule
    const rule = await CompetitorRule.findOne({
      $or: [{ _id: id }, { ruleId: id }],
    });

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: "Competitor rule not found",
      });
    }

    // Check for duplicate name (if name is being changed)
    if (updateData.ruleName && updateData.ruleName !== rule.ruleName) {
      const existingWithName = await CompetitorRule.findOne({
        ruleName: updateData.ruleName,
        _id: { $ne: rule._id },
      });

      if (existingWithName) {
        return res.status(409).json({
          success: false,
          message: `Rule with name "${updateData.ruleName}" already exists`,
        });
      }
    }

    // Fields that should be arrays
    const arrayFields = [
      "excludeCountries",
      "excludeConditions",
      "excludeProductTitleWords",
      "excludeSellers",
    ];

    // Handle default status separately
    const isDefault = updateData.isDefault;
    delete updateData.isDefault;

    // Update all fields except isDefault
    for (const [key, value] of Object.entries(updateData)) {
      // For array fields, replace only if the value is provided
      if (arrayFields.includes(key)) {
        if (Array.isArray(value)) {
          rule[key] = value;
        }
      } else {
        // For all other fields, update if provided
        if (value !== undefined) {
          rule[key] = value;
        }
      }
    }

    // Handle default status
    if (isDefault === true) {
      // Unset any existing defaults
      await CompetitorRule.updateMany(
        { isDefault: true },
        { isDefault: false }
      );
      rule.isDefault = true;
    } else if (isDefault === false) {
      rule.isDefault = false;
    }

    // Save changes
    await rule.save();

    return res.status(200).json({
      success: true,
      message: "Competitor rule updated successfully",
      data: rule,
    });
  } catch (error) {
    console.error("Error updating competitor rule:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating competitor rule",
      error: error.message,
    });
  }
};

/**
 * Delete a competitor rule
 * DELETE /api/ebay/competitor-rules/:id
 */
const deleteCompetitorRule = async (req, res) => {
  try {
    const { id } = req.params;

    const rule = await CompetitorRule.findOne({
      $or: [{ _id: id }, { ruleId: id }],
    });

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: "Competitor rule not found",
      });
    }

    // Check if rule is in use
    if (rule.appliesTo && rule.appliesTo.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete rule that is applied to items",
        appliedItemCount: rule.appliesTo.length,
      });
    }

    // Delete the rule
    await rule.remove();

    return res.status(200).json({
      success: true,
      message: "Competitor rule deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting competitor rule:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting competitor rule",
      error: error.message,
    });
  }
};

/**
 * Apply a rule to items
 * POST /api/ebay/competitor-rules/:id/apply
 */
const applyRuleToItems = async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Array of items to apply rule to is required",
      });
    }

    // Find the rule
    const rule = await CompetitorRule.findOne({
      $or: [{ _id: id }, { ruleId: id }],
    });

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: "Competitor rule not found",
      });
    }

    // Apply rule to each item
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
        // Add item to rule's appliesTo array
        await rule.applyToItem(
          item.itemId,
          item.sku || null,
          item.title || null
        );

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
    rule.usageCount += results.filter((r) => r.success).length;
    rule.lastUsed = new Date();

    // Save the rule
    await rule.save();

    return res.status(200).json({
      success: true,
      message: `Rule applied to ${
        results.filter((r) => r.success).length
      } items`,
      totalItems: items.length,
      results,
    });
  } catch (error) {
    console.error("Error applying competitor rule:", error);
    return res.status(500).json({
      success: false,
      message: "Error applying competitor rule",
      error: error.message,
    });
  }
};

/**
 * Get rules applied to an item
 * GET /api/ebay/competitor-rules/item/:itemId
 */
const getRulesForItem = async (req, res) => {
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

    const rules = await CompetitorRule.find(query);

    return res.status(200).json({
      success: true,
      count: rules.length,
      itemId,
      sku: sku || "all",
      data: rules,
    });
  } catch (error) {
    console.error("Error fetching rules for item:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching rules for item",
      error: error.message,
    });
  }
};

/**
 * Remove a rule from an item
 * DELETE /api/ebay/competitor-rules/:id/item/:itemId
 */
const removeRuleFromItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { sku } = req.query;

    // Find the rule
    const rule = await CompetitorRule.findOne({
      $or: [{ _id: id }, { ruleId: id }],
    });

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: "Competitor rule not found",
      });
    }

    // Find the item in the appliesTo array
    const initialCount = rule.appliesTo.length;

    // Remove matching items
    rule.appliesTo = rule.appliesTo.filter((item) => {
      if (item.itemId === itemId) {
        if (sku && item.sku !== sku) {
          return true; // Keep if SKU doesn't match
        }
        return false; // Remove if all criteria match
      }
      return true; // Keep all other items
    });

    const removedCount = initialCount - rule.appliesTo.length;

    if (removedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Item not found in rule's applied items",
      });
    }

    // Save the rule
    await rule.save();

    return res.status(200).json({
      success: true,
      message: `Rule removed from ${removedCount} item(s)`,
      itemId,
      sku: sku || "all",
    });
  } catch (error) {
    console.error("Error removing rule from item:", error);
    return res.status(500).json({
      success: false,
      message: "Error removing rule from item",
      error: error.message,
    });
  }
};

/**
 * Update rule execution statistics
 * POST /api/ebay/competitor-rules/:id/execution-stats
 */
const updateRuleExecutionStats = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      itemId,
      sku,
      competitorsFound,
      competitorsExcluded,
      finalCompetitorsUsed,
    } = req.body;

    if (!itemId || competitorsFound === undefined) {
      return res.status(400).json({
        success: false,
        message: "Item ID and competitors found count are required",
      });
    }

    // Find the rule
    const rule = await CompetitorRule.findOne({
      $or: [{ _id: id }, { ruleId: id }],
    });

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: "Competitor rule not found",
      });
    }

    // Initialize execution stats if not present
    if (!rule.executionStats) {
      rule.executionStats = {
        totalCompetitorsFound: 0,
        competitorsExcluded: 0,
        executionHistory: [],
      };
    }

    // Update total stats
    rule.executionStats.totalCompetitorsFound += competitorsFound;
    rule.executionStats.competitorsExcluded += competitorsExcluded || 0;
    rule.executionStats.lastExecution = new Date();

    // Add to execution history
    if (!rule.executionStats.executionHistory) {
      rule.executionStats.executionHistory = [];
    }

    rule.executionStats.executionHistory.push({
      date: new Date(),
      itemId,
      sku: sku || null,
      competitorsFound,
      competitorsExcluded: competitorsExcluded || 0,
      finalCompetitorsUsed:
        finalCompetitorsUsed || competitorsFound - (competitorsExcluded || 0),
    });

    // Limit history size to last 100 executions
    if (rule.executionStats.executionHistory.length > 100) {
      rule.executionStats.executionHistory =
        rule.executionStats.executionHistory.slice(-100);
    }

    // Save the rule
    await rule.save();

    return res.status(200).json({
      success: true,
      message: "Rule execution statistics updated",
      data: {
        ruleId: rule.ruleId,
        ruleName: rule.ruleName,
        executionStats: rule.executionStats,
      },
    });
  } catch (error) {
    console.error("Error updating rule execution stats:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating rule execution statistics",
      error: error.message,
    });
  }
};

export {
  createCompetitorRule,
  getAllCompetitorRules,
  getCompetitorRule,
  updateCompetitorRule,
  deleteCompetitorRule,
  applyRuleToItems,
  getRulesForItem,
  removeRuleFromItem,
  updateRuleExecutionStats,
};

/*

router.post('/competitor-rules', createCompetitorRule);
router.get('/competitor-rules', getAllCompetitorRules);
router.get('/competitor-rules/:id', getCompetitorRule);
router.put('/competitor-rules/:id', updateCompetitorRule);
router.delete('/competitor-rules/:id', deleteCompetitorRule);

// Rule application routes
router.post('/competitor-rules/:id/apply', applyRuleToItems);
router.get('/competitor-rules/item/:itemId', getRulesForItem);
router.delete('/competitor-rules/:id/item/:itemId', removeRuleFromItem);

// Rule execution statistics
router.post('/competitor-rules/:id/execution-stats', updateRuleExecutionStats);

*/
