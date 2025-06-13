// routes/inventory.js

import express from 'express';
import { requireAuth } from '../controllers/middleware/authMiddleware.js';
import {
  getActiveListings,
  getCompetitorPrice,
  syncPriceWithStrategy,
  getCurrentEbayPrice,
} from '../services/inventoryService.js';

const router = express.Router();

// ...existing routes...

// Add new route for manual price sync
router.post('/sync-price/:itemId', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.user?.id;

    console.log(
      `🔄 Manual price sync triggered for item ${itemId} by user ${userId}`
    );

    const result = await syncPriceWithStrategy(itemId, userId);

    return res.json({
      success: true,
      message: `Price sync completed for item ${itemId}`,
      data: result,
    });
  } catch (error) {
    console.error('Error in manual price sync:', error);
    return res.status(500).json({
      success: false,
      message: 'Error syncing price',
      error: error.message,
    });
  }
});

// Add route for getting current eBay price
router.get('/current-price/:itemId', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { sku } = req.query;
    const userId = req.user?.id;

    const result = await getCurrentEbayPrice(itemId, sku, userId);

    return res.json(result);
  } catch (error) {
    console.error('Error getting current eBay price:', error);
    return res.status(500).json({
      success: false,
      message: 'Error getting current price',
      error: error.message,
    });
  }
});

export default router;
