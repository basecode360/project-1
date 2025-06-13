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

/**
 * GET /api/price-history/product/:itemId
 * Get price history for a specific product (for the listings table)
 * Query params:
 *   - limit (optional, defaults to 100)
 */
router.get('/product/:itemId', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { itemId } = req.params;
    const { limit = 100 } = req.query;

    console.log(
      `📊 Fetching price history for product ${itemId}, limit: ${limit}`
    );

    // Fetch records for this specific product, most recent first
    const records = await fetchRawPriceHistory({
      itemId,
      sku: null, // Get all SKUs for this item
      limit: Number(limit),
    });

    // Calculate summary statistics
    let summary = null;
    if (records.length > 0) {
      const successfulRecords = records.filter((r) => r.success);

      if (successfulRecords.length > 0) {
        const latestRecord = successfulRecords[0];
        const oldestRecord = successfulRecords[successfulRecords.length - 1];

        const currentPrice = latestRecord.newPrice;
        const startPrice = oldestRecord.newPrice;
        const totalChange = currentPrice - startPrice;
        const percentChange =
          startPrice > 0 ? (totalChange / startPrice) * 100 : 0;

        // Count changes by strategy
        const strategyChanges = {};
        successfulRecords.forEach((record) => {
          if (record.strategyName) {
            strategyChanges[record.strategyName] =
              (strategyChanges[record.strategyName] || 0) + 1;
          }
        });

        summary = {
          currentPrice,
          startPrice,
          totalChange: parseFloat(totalChange.toFixed(2)),
          percentChange: parseFloat(percentChange.toFixed(2)),
          totalRecords: records.length,
          successfulChanges: successfulRecords.length,
          failedChanges: records.length - successfulRecords.length,
          latestUpdate: latestRecord.createdAt,
          firstRecord: oldestRecord.createdAt,
          strategyBreakdown: strategyChanges,
          priceDirection:
            totalChange > 0
              ? 'increased'
              : totalChange < 0
              ? 'decreased'
              : 'unchanged',
        };
      }
    }

    return res.json({
      success: true,
      itemId,
      recordCount: records.length,
      summary,
      priceHistory: records.map((record) => ({
        id: record._id,
        date: record.createdAt,
        oldPrice: record.oldPrice,
        newPrice: record.newPrice,
        changeAmount: record.changeAmount,
        changePercentage: record.changePercentage,
        changeDirection: record.changeDirection,
        strategyName: record.strategyName,
        competitorPrice: record.competitorLowestPrice,
        status: record.status,
        source: record.source,
        success: record.success,
        error: record.error,
        sku: record.sku,
        title: record.title,
      })),
    });
  } catch (error) {
    console.error('Error fetching product price history:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching price history',
      error: error.message,
    });
  }
});

/**
 * GET /api/price-history/product/:itemId/paginated
 * Get paginated price history for products with 100+ records
 */
router.get('/product/:itemId/paginated', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const {
      sku = null,
      limit = 100,
      page = 1,
      sortBy = 'createdAt',
      sortOrder = -1,
    } = req.query;

    console.log(
      `📊 Fetching paginated price history for ${itemId}, page: ${page}`
    );

    const { getPaginatedPriceHistory } = await import(
      '../services/historyService.js'
    );

    const result = await getPaginatedPriceHistory({
      itemId,
      sku,
      limit: Number(limit),
      page: Number(page),
      sortBy,
      sortOrder: Number(sortOrder),
    });

    return res.json({
      success: true,
      itemId,
      sku,
      ...result,
      priceHistory: result.records.map((record) => ({
        id: record._id,
        date: record.createdAt,
        oldPrice: record.oldPrice,
        newPrice: record.newPrice,
        changeAmount: record.changeAmount,
        changePercentage: record.changePercentage,
        changeDirection: record.changeDirection,
        strategyName: record.strategyName,
        competitorPrice: record.competitorLowestPrice,
        status: record.status,
        source: record.source,
        success: record.success,
        error: record.error,
        sku: record.sku,
        title: record.title,
        executedAt: record.executedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching paginated price history:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching paginated price history',
      error: error.message,
    });
  }
});

/**
 * POST /api/price-history/bulk
 * Bulk insert price history records
 */
router.post('/bulk', requireAuth, async (req, res) => {
  try {
    const { records } = req.body;
    const userId = req.user.id;

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Records array is required',
      });
    }

    // Add userId to all records
    const recordsWithUser = records.map((record) => ({
      ...record,
      userId,
    }));

    const { bulkInsertPriceHistory } = await import(
      '../services/historyService.js'
    );
    const result = await bulkInsertPriceHistory(recordsWithUser);

    return res.json({
      success: true,
      message: `Bulk inserted ${result.insertedCount} price history records`,
      ...result,
    });
  } catch (error) {
    console.error('Error bulk inserting price history:', error);
    return res.status(500).json({
      success: false,
      message: 'Error bulk inserting price history',
      error: error.message,
    });
  }
});

/**
 * POST /api/price-history/archive
 * Archive old price history records
 */
router.post('/archive', requireAuth, async (req, res) => {
  try {
    const { keepRecentCount = 1000 } = req.body;

    const { archiveOldPriceHistory } = await import(
      '../services/historyService.js'
    );
    const result = await archiveOldPriceHistory(Number(keepRecentCount));

    return res.json({
      success: true,
      message: `Archived old price history records`,
      ...result,
    });
  } catch (error) {
    console.error('Error archiving price history:', error);
    return res.status(500).json({
      success: false,
      message: 'Error archiving price history',
      error: error.message,
    });
  }
});

/**
 * GET /api/price-history/summary/:itemId
 * Get just the summary statistics for a product (lightweight for table display)
 */
router.get('/summary/:itemId', requireAuth, async (req, res) => {
  try {
    const { itemId } = req.params;

    // Fetch only recent records for summary
    const records = await fetchRawPriceHistory({
      itemId,
      sku: null,
      limit: 10, // Just need recent records for summary
    });

    let summary = {
      hasHistory: false,
      totalChanges: 0,
      latestChange: null,
      currentPrice: null,
      priceDirection: 'unchanged',
    };

    if (records.length > 0) {
      const successfulRecords = records.filter((r) => r.success);

      if (successfulRecords.length > 0) {
        const latestRecord = successfulRecords[0];

        summary = {
          hasHistory: true,
          totalChanges: successfulRecords.length,
          latestChange: latestRecord.createdAt,
          currentPrice: latestRecord.newPrice,
          lastChangeAmount: latestRecord.changeAmount,
          priceDirection: latestRecord.changeDirection || 'unchanged',
          lastStrategy: latestRecord.strategyName,
        };
      }
    }

    return res.json({
      success: true,
      itemId,
      summary,
    });
  } catch (error) {
    console.error('Error fetching price history summary:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching price history summary',
      error: error.message,
    });
  }
});

export default router;
