// routes/priceHistoryRoutes.js

import express from 'express';
import { requireAuth } from '../controllers/middleware/authMiddleware.js';
import {
  recordPriceChange,
  fetchRawPriceHistory,
  getPriceAnalytics,
} from '../services/historyService.js';

const router = express.Router();

/**
 * GET /api/price-history/history/:itemId
 * Retrieve raw price-history entries; each record now includes:
 *   itemId, sku, title, oldPrice, newPrice, competitorLowestPrice,
 *   strategyName, status, createdAt, etc.
 *
 * Query params:
 *   - sku   (optional)
 *   - limit (optional, defaults to 100)
 */
router.get('/history/:itemId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;
    const { sku = null, limit = 100 } = req.query;

    // Fetch raw records (most recent first)
    const records = await fetchRawPriceHistory({
      itemId,
      sku,
      limit: Number(limit),
    });

    return res.json({
      success: true,
      itemId,
      sku,
      recordCount: records.length,
      priceHistory: records,
    });
  } catch (error) {
    console.error('Error fetching price history:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching price history',
      error: error.message,
    });
  }
});

/**
 * POST /api/price-history/history/manual
 * Manually record a price change. Body must include:
 * {
 *   itemId: string,
 *   sku: string,
 *   title?: string,
 *   oldPrice?: number,
 *   newPrice: number,
 *   competitorLowestPrice?: number,
 *   strategyName?: string,
 *   status: 'Done'|'Skipped'|'Error'|'Manual',
 *   currency?: string,
 *   source?: 'api'|'manual'|'system',
 *   success: boolean,
 *   apiResponse?: any,
 *   error?: any,
 *   metadata?: any
 * }
 */
router.post('/history/manual', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      itemId,
      sku,
      title = null,
      oldPrice = null,
      newPrice,
      currency = 'USD',
      competitorLowestPrice = null,
      strategyName = null,
      status,
      source = 'manual',
      apiResponse = null,
      success,
      error = null,
      metadata = {},
    } = req.body;

    if (
      !itemId ||
      sku == null ||
      newPrice == null ||
      status == null ||
      success == null
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Missing required fields: itemId, sku, newPrice, status, and success are required.',
      });
    }

    const record = await recordPriceChange({
      userId,
      itemId,
      sku,
      title,
      oldPrice,
      newPrice,
      currency,
      competitorLowestPrice,
      strategyName,
      status,
      source,
      apiResponse,
      success,
      error,
      metadata,
    });

    return res.json({
      success: true,
      message: 'Price change recorded successfully',
      record,
    });
  } catch (err) {
    console.error('Error adding manual price record:', err);
    return res.status(500).json({
      success: false,
      message: 'Error adding manual price record',
      error: err.message,
    });
  }
});

/**
 * GET /api/price-history/analytics/:itemId
 * Return analytics for an item (and optional SKU) over period.
 * Query params:
 *   - sku (optional)
 *   - period in { '7d'|'30d'|'90d'|'1y'|'all' } (defaults to '30d')
 */
router.get('/analytics/:itemId', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { sku = null, period = '30d' } = req.query;

    const analytics = await getPriceAnalytics({ itemId, sku, period });
    return res.json({ success: true, analytics });
  } catch (err) {
    console.error('Error generating price analytics:', err);
    return res.status(500).json({
      success: false,
      message: 'Error generating price analytics',
      error: err.message,
    });
  }
});

/**
 * GET /api/price-history/export/:itemId
 * Export all price-history records as JSON or CSV.
 * Query params:
 *   - sku (optional)
 *   - format = 'json' | 'csv' (default: 'json')
 */
router.get('/export/:itemId', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { sku = null, format = 'json' } = req.query;

    // Fetch ALL history (limit = very large)
    const records = await fetchRawPriceHistory({
      itemId,
      sku,
      limit: Number.MAX_SAFE_INTEGER,
    });

    if (records.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No price history found for item ${itemId}${
          sku ? `, SKU ${sku}` : ''
        }`,
      });
    }

    if (format === 'csv') {
      // CSV header: list all fields we want to export
      const header = [
        'itemId',
        'sku',
        'title',
        'oldPrice',
        'newPrice',
        'currency',
        'competitorLowestPrice',
        'strategyName',
        'status',
        'changeAmount',
        'changePercentage',
        'changeDirection',
        'source',
        'success',
        'error',
        'createdAt',
      ].join(',');

      const rows = records.map((r) => {
        const fields = [
          r.itemId,
          r.sku,
          r.title || '',
          r.oldPrice != null ? r.oldPrice : '',
          r.newPrice,
          r.currency,
          r.competitorLowestPrice != null ? r.competitorLowestPrice : '',
          r.strategyName || '',
          r.status,
          r.changeAmount != null ? r.changeAmount : '',
          r.changePercentage != null ? r.changePercentage : '',
          r.changeDirection || '',
          r.source,
          r.success,
          r.error != null ? JSON.stringify(r.error) : '',
          r.createdAt.toISOString(),
        ];
        // Escape commas in title if needed
        const escaped = fields.map((f) =>
          typeof f === 'string' && f.includes(',')
            ? `"${f.replace(/"/g, '""')}"`
            : f
        );
        return escaped.join(',');
      });

      const csvContent = [header, ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="price_history_${itemId}.csv"`
      );
      return res.send(csvContent);
    } else {
      // JSON
      return res.json({
        success: true,
        itemId,
        sku,
        recordCount: records.length,
        priceHistory: records,
      });
    }
  } catch (err) {
    console.error('Error exporting price history:', err);
    return res.status(500).json({
      success: false,
      message: 'Error exporting price history',
      error: err.message,
    });
  }
});

export default router;
