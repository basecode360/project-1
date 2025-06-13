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

// Add new route to check stored prices
router.get('/stored-prices', requireAuth, async (req, res) => {
  try {
    if (!global.priceStore) {
      global.priceStore = new Map();
    }

    const storedPrices = Array.from(global.priceStore.entries()).map(
      ([key, data]) => ({
        key,
        itemId: data.itemId,
        sku: data.sku,
        price: data.price,
        timestamp: new Date(data.timestamp).toISOString(),
        ageSeconds: Math.round((Date.now() - data.timestamp) / 1000),
      })
    );

    return res.json({
      success: true,
      message: 'Current stored prices',
      count: storedPrices.length,
      data: storedPrices,
    });
  } catch (error) {
    console.error('Error getting stored prices:', error);
    return res.status(500).json({
      success: false,
      message: 'Error getting stored prices',
      error: error.message,
    });
  }
});

// Add route to manually force price update in listings
router.post('/force-price-update/:itemId', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { price, sku = 'PART123' } = req.body;

    if (!price) {
      return res.status(400).json({
        success: false,
        message: 'Price is required',
      });
    }

    const { storeUpdatedPrice } = await import(
      '../services/inventoryService.js'
    );
    const result = storeUpdatedPrice(itemId, sku, price);

    return res.json({
      success: true,
      message: `Manually stored price $${price} for ${itemId}/${sku}`,
      data: result,
    });
  } catch (error) {
    console.error('Error forcing price update:', error);
    return res.status(500).json({
      success: false,
      message: 'Error forcing price update',
      error: error.message,
    });
  }
});

export default router;
