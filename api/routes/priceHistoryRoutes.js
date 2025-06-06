// routes/priceHistoryRoutes.js
import express from 'express';
import { getItemPriceHistory, addManualPriceRecord } from '../controllers/HistoryFunctions.js';

const router = express.Router();

// Price update endpoint (existing)

// New endpoints for price history
router.get('/history/:itemId', getItemPriceHistory);
router.post('/history/manual', addManualPriceRecord);

// New endpoint to get price change analytics
router.get('/analytics/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { sku, period = '30d' } = req.query;
    
    // Get model from import
    const PriceHistory = req.app.get('models').PriceHistory;
    
    // Calculate date range based on period
    const endDate = new Date();
    let startDate = new Date();
    
    switch(period) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      case 'all':
        startDate = new Date(0); // Beginning of time
        break;
      default:
        startDate.setDate(startDate.getDate() - 30); // Default to 30 days
    }
    
    // Build query
    const query = { 
      itemId,
      success: true,
      createdAt: { $gte: startDate, $lte: endDate }
    };
    
    if (sku) {
      query.sku = sku;
    }
    
    // Get price records in date range
    const priceRecords = await PriceHistory.find(query)
      .sort({ createdAt: 1 });
    
    // If SKU specified, get analytics for that SKU
    if (sku) {
      if (priceRecords.length === 0) {
        return res.status(404).json({
          success: false,
          message: `No price history found for item ${itemId}, SKU ${sku} in the selected period`
        });
      }
      
      const firstRecord = priceRecords[0];
      const lastRecord = priceRecords[priceRecords.length - 1];
      const priceChanges = priceRecords.length - 1;
      
      const analytics = {
        itemId,
        sku,
        period,
        startDate,
        endDate,
        priceAtStart: firstRecord.newPrice,
        currentPrice: lastRecord.newPrice,
        priceChange: lastRecord.newPrice - firstRecord.newPrice,
        percentageChange: ((lastRecord.newPrice - firstRecord.newPrice) / firstRecord.newPrice) * 100,
        totalChanges: priceChanges,
        changeFrequency: priceChanges > 0 ? 
          `${(priceChanges / Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24))).toFixed(2)} changes per day` : 
          'No changes',
        pricePoints: priceRecords.map(record => ({
          price: record.newPrice,
          date: record.createdAt,
          change: record.changeAmount,
          percentChange: record.changePercentage
        }))
      };
      
      return res.json({
        success: true,
        analytics
      });
    } 
    // If no SKU, group by SKU and get analytics for each
    else {
      // Group records by SKU
      const skuGroups = {};
      
      priceRecords.forEach(record => {
        if (!skuGroups[record.sku]) {
          skuGroups[record.sku] = [];
        }
        skuGroups[record.sku].push(record);
      });
      
      // Generate analytics for each SKU
      const skuAnalytics = {};
      
      Object.entries(skuGroups).forEach(([sku, records]) => {
        if (records.length === 0) return;
        
        const firstRecord = records[0];
        const lastRecord = records[records.length - 1];
        const priceChanges = records.length - 1;
        
        skuAnalytics[sku] = {
          priceAtStart: firstRecord.newPrice,
          currentPrice: lastRecord.newPrice,
          priceChange: lastRecord.newPrice - firstRecord.newPrice,
          percentageChange: ((lastRecord.newPrice - firstRecord.newPrice) / firstRecord.newPrice) * 100,
          totalChanges: priceChanges,
          lastUpdated: lastRecord.createdAt
        };
      });
      
      return res.json({
        success: true,
        itemId,
        period,
        startDate,
        endDate,
        totalSkus: Object.keys(skuAnalytics).length,
        skuAnalytics
      });
    }
    
  } catch (error) {
    console.error('Error generating price analytics:', error);
    return res.status(500).json({
      success: false,
      message: "Error generating price analytics",
      error: error.message
    });
  }
});

// Bulk data export for price history
router.get('/export/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { format = 'json' } = req.query;
    
    // Get model from import
    const PriceHistory = req.app.get('models').PriceHistory;
    
    // Get all price history for item
    const priceHistory = await PriceHistory.find({ itemId, success: true })
      .sort({ sku: 1, createdAt: 1 });
    
    if (priceHistory.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No price history found for item ${itemId}`
      });
    }
    
    // Format output based on requested format
    if (format === 'csv') {
      // Create CSV content
      const csvHeader = 'SKU,Price,Currency,Date,ChangeAmount,ChangePercentage\n';
      const csvRows = priceHistory.map(record => {
        return `${record.sku},${record.newPrice},${record.currency},${record.createdAt.toISOString()},${record.changeAmount || ''},${record.changePercentage || ''}`;
      }).join('\n');
      
      const csvContent = csvHeader + csvRows;
      
      // Set headers for file download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="price_history_${itemId}.csv"`);
      
      return res.send(csvContent);
    } else {
      // Return JSON format
      return res.json({
        success: true,
        itemId,
        recordCount: priceHistory.length,
        priceHistory
      });
    }
    
  } catch (error) {
    console.error('Error exporting price history:', error);
    return res.status(500).json({
      success: false,
      message: "Error exporting price history",
      error: error.message
    });
  }
});

export default router;