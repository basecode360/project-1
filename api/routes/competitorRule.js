import express from "express";

const router = express.Router();

// In-memory storage for competitor rules (replace with your database)
let competitorRules = [];
let ruleIdCounter = 1;

// ===============================
// COMPETITOR RULES APIs
// ===============================

// 1. Create Competitor Rule
router.post("/", async (req, res) => {
  try {
    const {
      ruleName,
      minPercentOfCurrentPrice,
      maxPercentOfCurrentPrice,
      excludeCountries = [],
      excludeConditions = [],
      excludeProductTitleWords = [],
      excludeSellers = [],
      findCompetitorsBasedOnMPN = false,
      assignToActiveListings = false,
      listings = [],
    } = req.body;

    // Validation
    if (!ruleName || ruleName.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Rule name is required",
      });
    }

    // Validate percentages
    if (minPercentOfCurrentPrice !== undefined) {
      if (
        typeof minPercentOfCurrentPrice !== "number" ||
        minPercentOfCurrentPrice < 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Minimum percent must be a non-negative number",
        });
      }
    }

    if (maxPercentOfCurrentPrice !== undefined) {
      if (
        typeof maxPercentOfCurrentPrice !== "number" ||
        maxPercentOfCurrentPrice < 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Maximum percent must be a non-negative number",
        });
      }
    }

    // Validate min is less than max
    if (
      minPercentOfCurrentPrice !== undefined &&
      maxPercentOfCurrentPrice !== undefined
    ) {
      if (minPercentOfCurrentPrice >= maxPercentOfCurrentPrice) {
        return res.status(400).json({
          success: false,
          message: "Minimum percent must be less than maximum percent",
        });
      }
    }

    // Create competitor rule object
    const competitorRule = {
      id: ruleIdCounter++,
      ruleName: ruleName.trim(),
      criteria: {
        minPercentOfCurrentPrice: minPercentOfCurrentPrice || null,
        maxPercentOfCurrentPrice: maxPercentOfCurrentPrice || null,
        excludeCountries: Array.isArray(excludeCountries)
          ? excludeCountries
          : [],
        excludeConditions: Array.isArray(excludeConditions)
          ? excludeConditions
          : [],
        excludeProductTitleWords: Array.isArray(excludeProductTitleWords)
          ? excludeProductTitleWords
          : [],
        excludeSellers: Array.isArray(excludeSellers) ? excludeSellers : [],
        findCompetitorsBasedOnMPN: Boolean(findCompetitorsBasedOnMPN),
      },
      assignToActiveListings: Boolean(assignToActiveListings),
      listings: Array.isArray(listings) ? listings : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
    };

    competitorRules.push(competitorRule);

    res.status(201).json({
      success: true,
      message: "Competitor rule created successfully",
      rule: competitorRule,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 2. Get all competitor rules
router.get("/get-rules", async (req, res) => {
  try {
    const { isActive } = req.query;

    let filteredRules = competitorRules;

    // Filter by active status if provided
    if (isActive !== undefined) {
      const activeFilter = isActive === "true";
      filteredRules = filteredRules.filter(
        (rule) => rule.isActive === activeFilter
      );
    }

    res.json({
      success: true,
      count: filteredRules.length,
      rules: filteredRules,
      debug: {
        totalInMemory: competitorRules.length,
        filterApplied: { isActive },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 3. Get competitor rule by ID
router.get("/competitor-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const rule = competitorRules.find((r) => r.id === parseInt(id));

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: "Competitor rule not found",
      });
    }

    res.json({
      success: true,
      rule,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 4. Update competitor rule
router.put("/competitor-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const ruleIndex = competitorRules.findIndex((r) => r.id === parseInt(id));

    if (ruleIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Competitor rule not found",
      });
    }

    // Validate percentages if being updated
    const { minPercentOfCurrentPrice, maxPercentOfCurrentPrice } = req.body;

    if (
      minPercentOfCurrentPrice !== undefined &&
      typeof minPercentOfCurrentPrice !== "number"
    ) {
      return res.status(400).json({
        success: false,
        message: "Minimum percent must be a number",
      });
    }

    if (
      maxPercentOfCurrentPrice !== undefined &&
      typeof maxPercentOfCurrentPrice !== "number"
    ) {
      return res.status(400).json({
        success: false,
        message: "Maximum percent must be a number",
      });
    }

    // Update rule
    const updatedRule = {
      ...competitorRules[ruleIndex],
      ...req.body,
      id: parseInt(id), // Preserve ID
      updatedAt: new Date().toISOString(),
    };

    // Update criteria if provided
    if (req.body.criteria) {
      updatedRule.criteria = {
        ...competitorRules[ruleIndex].criteria,
        ...req.body.criteria,
      };
    }

    competitorRules[ruleIndex] = updatedRule;

    res.json({
      success: true,
      message: "Competitor rule updated successfully",
      rule: updatedRule,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 5. Delete competitor rule
router.delete("/competitor-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const ruleIndex = competitorRules.findIndex((r) => r.id === parseInt(id));

    if (ruleIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Competitor rule not found",
      });
    }

    const deletedRule = competitorRules.splice(ruleIndex, 1)[0];

    res.json({
      success: true,
      message: "Competitor rule deleted successfully",
      rule: deletedRule,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 6. Toggle competitor rule active status
router.patch("/competitor-rules/:id/toggle", async (req, res) => {
  try {
    const { id } = req.params;
    const ruleIndex = competitorRules.findIndex((r) => r.id === parseInt(id));

    if (ruleIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Competitor rule not found",
      });
    }

    competitorRules[ruleIndex].isActive = !competitorRules[ruleIndex].isActive;
    competitorRules[ruleIndex].updatedAt = new Date().toISOString();

    res.json({
      success: true,
      message: `Competitor rule ${
        competitorRules[ruleIndex].isActive ? "activated" : "deactivated"
      } successfully`,
      rule: competitorRules[ruleIndex],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 7. Apply competitor rule to filter competitors
router.post("/competitor-rules/:id/apply", async (req, res) => {
  try {
    const { id } = req.params;
    const { competitors, currentPrice } = req.body;

    // Find the rule
    const rule = competitorRules.find((r) => r.id === parseInt(id));
    if (!rule) {
      return res.status(404).json({
        success: false,
        message: "Competitor rule not found",
      });
    }

    if (!rule.isActive) {
      return res.status(400).json({
        success: false,
        message: "Competitor rule is not active",
      });
    }

    if (!Array.isArray(competitors)) {
      return res.status(400).json({
        success: false,
        message: "Competitors must be an array",
      });
    }

    if (typeof currentPrice !== "number" || currentPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid current price is required",
      });
    }

    // Apply filtering based on rule criteria
    const filteredCompetitors = competitors.filter((competitor) => {
      const { criteria } = rule;

      // Check price range criteria
      if (criteria.minPercentOfCurrentPrice !== null) {
        const minPrice =
          currentPrice * (criteria.minPercentOfCurrentPrice / 100);
        if (competitor.price < minPrice) return false;
      }

      if (criteria.maxPercentOfCurrentPrice !== null) {
        const maxPrice =
          currentPrice * (criteria.maxPercentOfCurrentPrice / 100);
        if (competitor.price > maxPrice) return false;
      }

      // Check excluded countries
      if (criteria.excludeCountries.length > 0 && competitor.country) {
        if (
          criteria.excludeCountries.includes(competitor.country.toLowerCase())
        ) {
          return false;
        }
      }

      // Check excluded conditions
      if (criteria.excludeConditions.length > 0 && competitor.condition) {
        if (
          criteria.excludeConditions.includes(
            competitor.condition.toLowerCase()
          )
        ) {
          return false;
        }
      }

      // Check excluded title words
      if (criteria.excludeProductTitleWords.length > 0 && competitor.title) {
        const titleLower = competitor.title.toLowerCase();
        for (const word of criteria.excludeProductTitleWords) {
          if (titleLower.includes(word.toLowerCase())) {
            return false;
          }
        }
      }

      // Check excluded sellers
      if (criteria.excludeSellers.length > 0 && competitor.seller) {
        if (criteria.excludeSellers.includes(competitor.seller.toLowerCase())) {
          return false;
        }
      }

      return true;
    });

    res.json({
      success: true,
      rule: {
        id: rule.id,
        name: rule.ruleName,
      },
      filtering: {
        originalCount: competitors.length,
        filteredCount: filteredCompetitors.length,
        excludedCount: competitors.length - filteredCompetitors.length,
      },
      competitors: filteredCompetitors,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// 8. Test endpoint to check rules
router.get("/test-competitor-rules", async (req, res) => {
  res.json({
    success: true,
    totalRules: competitorRules.length,
    rulesData: competitorRules,
    counterValue: ruleIdCounter,
  });
});

export default router;

/*
POST /competitor-rulesdfasdsad
{
  "ruleName": "Mobile phones filtering",
  "minPercentOfCurrentPrice": 80,
  "maxPercentOfCurrentPrice": 120,
  "excludeCountries": ["Germany", "Italy"],
  "excludeConditions": ["New", "Used"],
  "excludeProductTitleWords": ["refurbished", "broken", "parts"],
  "excludeSellers": ["seller1", "seller2"],
  "findCompetitorsBasedOnMPN": true,
  "assignToActiveListings": false,
  "listings": ["314851424639", "314851424640"]
}


{
  "ruleName": "Electronics Competitor Filter",
  "minPercentOfCurrentPrice": 75,
  "maxPercentOfCurrentPrice": 150,
  "excludeCountries": ["Germany", "Italy", "France"],
  "excludeConditions": ["Used", "For parts or not working"],
  "excludeProductTitleWords": ["broken", "damaged", "cracked", "refurbished"],
  "excludeSellers": ["bad_seller_123", "spam_seller_456"],
  "findCompetitorsBasedOnMPN": true,
  "assignToActiveListings": true,
  "listings": []
}
*/
