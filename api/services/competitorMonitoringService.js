import cron from 'node-cron';
import ManualCompetitor from '../models/ManualCompetitor.js';
import Product from '../models/Product.js';
import PricingStrategy from '../models/PricingStrategy.js';
import executePricingStrategy from './strategyService.js';

export async function updateCompetitorPrices() {
  // grab only items you actually want to monitor
  const docs = await ManualCompetitor.find({ monitoringEnabled: true });

  for (const doc of docs) {
    const prices = doc.competitors.map((c) => +c.price).filter((p) => p > 0);
    const newLow = prices.length ? Math.min(...prices) : null;

    // only re‐run when competitor price moves
    if (newLow !== null && newLow !== doc.lastLowestPrice) {
      // 1) look up *your* product & its strategy
      const prod = await Product.findOne({ itemId: doc.itemId });
      if (prod?.strategy) {
        const strat = await PricingStrategy.findById(prod.strategy);
        if (strat) {
          console.log(
            `⏩ repricing ${doc.itemId} with "${strat.strategyName}"`
          );

          // 2) run your existing repricer
          const result = await executePricingStrategy(doc.itemId, strat);

          // 3) if it actually changed, persist it back into Product
          if (result.success && result.priceChanged) {
            await Product.updateOne(
              { itemId: doc.itemId },
              { $set: { price: result.newPrice } }
            );
          }
        }
      }

      doc.lastLowestPrice = newLow;
    }

    doc.lastMonitoringCheck = new Date();
    await doc.save();
    await new Promise((r) => setTimeout(r, 500)); // rate-limit
  }
}

// schedule every 20 seconds (or however you want)
export function startCompetitorMonitoring() {
  cron.schedule('*/20 * * * * *', async () => {
    console.log('⏱ [monitor] running competitor price check…');
    await updateCompetitorPrices();
  });
}
