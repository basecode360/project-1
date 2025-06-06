import express from "express";
import {
  createPricingStrategy,
  getAllPricingStrategies,
  updatePricingStrategy,
  deletePricingStrategy,
  getActivePricingStrategies,
  applyStrategyToItems,
} from "../controllers/strategyController.js";

const router = express.Router();

// Create pricing strategy for specific item
router.post("/products/:itemId", createPricingStrategy);

// Get pricing strategy for specific item
router.get("/products/:itemId", getAllPricingStrategies);

// Update pricing strategy for specific item
router.put("/products/:itemId", updatePricingStrategy);

// Delete pricing strategy from specific item
router.delete("/products/:itemId", deletePricingStrategy);

// Get all active listings with pricing strategies
router.get("/active-listings", getActivePricingStrategies);

// Bulk assign strategy to items
router.post("/apply-bulk", applyStrategyToItems);

// Apply strategy to all active listings
router.post("/assign-to-all-active", createPricingStrategy);

export default router;
