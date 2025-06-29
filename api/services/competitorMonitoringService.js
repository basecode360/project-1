import cron from 'node-cron';
import ManualCompetitor from '../models/ManualCompetitor.js';
import Product from '../models/Product.js';
import { executeStrategyForItem } from './strategyService.js';
import { refreshManualCompetitorPrices } from './inventoryService.js';

export async function updateCompetitorPrices() {
  const allDocs = await ManualCompetitor.find({ monitoringEnabled: true });

  for (const doc of allDocs) {
    // 1) refresh every competitor’s live price and save
    await refreshManualCompetitorPrices(doc.itemId, doc.userId);

    // 2) reload so we see updated prices
    const fresh = await ManualCompetitor.findById(doc._id);

    // 3) compute the new lowest competitor price
    const prices = fresh.competitors
      .map((c) => parseFloat(c.price))
      .filter((p) => !isNaN(p) && p > 0);

    const newLowest = prices.length ? Math.min(...prices) : null;

    // 4) compare and trigger repricer
    if (newLowest !== null && newLowest !== fresh.lastLowestPrice) {
      console.log(
        `⏩ Price moved from ${fresh.lastLowestPrice} to ${newLowest}`
      );
      const product = await Product.findOne({ itemId: fresh.itemId });
      if (product?.strategy) {
        await executeStrategyForItem(
          fresh.itemId,
          fresh.userId,
          product.strategy
        );
      }
      fresh.lastLowestPrice = newLowest;
    }

    fresh.lastMonitoringCheck = new Date();
    await fresh.save();

    // rate-limit
    await new Promise((r) => setTimeout(r, 500));
  }
}


export function startCompetitorMonitoring() {
  cron.schedule('*/20 * * * * *', async () => {
    console.log('⏱ [monitor] running competitor price check…');
    await updateCompetitorPrices();
  });
}
