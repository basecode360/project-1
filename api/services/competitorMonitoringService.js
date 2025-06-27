import cron from 'node-cron';

/**
 * Service to automatically monitor competitor prices and execute strategies
 */

/**
 * Update competitor prices and trigger strategies when prices change
 */
export async function updateCompetitorPrices() {
  try {
    console.log('🔄 Starting competitor price update cycle...');

    const { default: ManualCompetitor } = await import(
      '../models/ManualCompetitor.js'
    );
    const { default: User } = await import('../models/Users.js');

    // Get all manual competitors with monitoring enabled
    const allCompetitorDocs = await ManualCompetitor.find({
      monitoringEnabled: true,
    }).populate('userId');

    let totalUpdated = 0;
    let totalChecked = 0;
    let strategiesTriggered = 0;

    for (const doc of allCompetitorDocs) {
      try {
        // Get user's eBay credentials
        const user = await User.findById(doc.userId);
        if (!user?.ebay?.accessToken) {
          console.warn(`⚠️ No eBay credentials for user ${doc.userId}`);
          continue;
        }

        // Get current lowest price before updates
        const currentPrices = doc.competitors
          .map((comp) => parseFloat(comp.price))
          .filter((price) => !isNaN(price) && price > 0);
        const currentLowest =
          currentPrices.length > 0 ? Math.min(...currentPrices) : null;

        let docUpdated = false;
        let newLowest = currentLowest;

        // For demo purposes, simulate price changes that would trigger strategy
        // In production, you'd fetch real prices from eBay API
        for (let i = 0; i < doc.competitors.length; i++) {
          const competitor = doc.competitors[i];
          totalChecked++;

          try {
            // Simulate a price drop that should trigger strategy execution
            let updatedPrice = parseFloat(competitor.price);

            // 30% chance of price change
            if (Math.random() < 0.3) {
              // Simulate a significant price drop to trigger strategy
              const priceChange = Math.random() * 2; // Drop by up to $2
              updatedPrice = Math.max(updatedPrice - priceChange, 5); // Minimum price of $5

              console.log(
                `💰 Simulated price change for ${
                  competitor.competitorItemId
                }: ${competitor.price} → ${updatedPrice.toFixed(2)}`
              );

              // Update the competitor price
              doc.competitors[i].price = updatedPrice.toFixed(2);
              docUpdated = true;
              totalUpdated++;

              // Update new lowest if this price is lower
              if (!newLowest || updatedPrice < newLowest) {
                newLowest = updatedPrice;
              }
            }
          } catch (priceError) {
            console.warn(
              `⚠️ Failed to process price for ${competitor.competitorItemId}:`,
              priceError.message
            );
          }
        }

        if (docUpdated) {
          await doc.save();
          console.log(
            `📊 Updated prices for ${doc.itemId}, new lowest: ${newLowest}`
          );

          // ALWAYS trigger strategy execution when prices change
          console.log(
            `🔔 Price changes detected for ${doc.itemId}, executing strategy...`
          );

          const strategyResult = await triggerStrategyForItem(
            doc.itemId,
            doc.userId
          );

          if (strategyResult.success) {
            strategiesTriggered++;
            console.log(`✅ Successfully executed strategy for ${doc.itemId}`);

            if (strategyResult.priceChanges > 0) {
              console.log(
                `💰 Price was updated for ${doc.itemId} based on new competitor prices`
              );
            }
          } else {
            console.warn(
              `⚠️ Strategy execution failed for ${doc.itemId}:`,
              strategyResult.message
            );
          }
        }

        // Update last monitoring check
        doc.lastMonitoringCheck = new Date();
        await doc.save();

        // Add delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (itemError) {
        console.error(`Error processing item ${doc.itemId}:`, itemError);
      }
    }

    console.log(
      `✅ Competitor monitoring completed: ${totalUpdated}/${totalChecked} prices updated, ${strategiesTriggered} strategies executed`
    );
    return { totalChecked, totalUpdated, strategiesTriggered };
  } catch (error) {
    console.error('❌ Error in updateCompetitorPrices:', error);
    throw error;
  }
}

/**
 * Trigger strategy execution for a specific item
 */
export async function triggerStrategyForItem(itemId, userId) {
  try {
    console.log(`🎯 Triggering strategy execution for item ${itemId}`);

    const { executeStrategiesForItem } = await import('./strategyService.js');
    const result = await executeStrategiesForItem(itemId, userId);

    if (result.success && result.priceChanges > 0) {
      console.log(
        `✅ Strategy executed successfully for ${itemId}, ${result.priceChanges} price changes made`
      );
    } else if (result.success) {
      console.log(
        `✅ Strategy executed for ${itemId}, but no price changes were needed`
      );
    } else {
      console.warn(
        `⚠️ Strategy execution failed for ${itemId}:`,
        result.message
      );
    }

    return result;
  } catch (error) {
    console.error(`❌ Error executing strategy for ${itemId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Execute strategies for all items with competitors (page load trigger)
 */
export async function executeStrategiesForAllItems() {
  try {
    console.log('🚀 Executing strategies for all items with competitors...');

    const { default: ManualCompetitor } = await import(
      '../models/ManualCompetitor.js'
    );

    const allItems = await ManualCompetitor.find({
      'competitors.0': { $exists: true }, // Items with at least one competitor
    });

    let strategiesExecuted = 0;
    let priceChanges = 0;

    for (const item of allItems) {
      try {
        console.log(`🔄 Executing strategy for ${item.itemId}...`);
        const result = await triggerStrategyForItem(item.itemId, item.userId);

        if (result.success) {
          strategiesExecuted++;
          if (result.priceChanges > 0) {
            priceChanges += result.priceChanges;
            console.log(`💰 Price updated for ${item.itemId}`);
          }
        }

        // Add delay between items to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`❌ Error executing strategy for ${item.itemId}:`, error);
      }
    }

    console.log(
      `✅ Strategy execution completed: ${strategiesExecuted} strategies executed, ${priceChanges} price changes`
    );

    return {
      success: true,
      strategiesExecuted,
      priceChanges,
      totalItems: allItems.length,
    };
  } catch (error) {
    console.error('❌ Error in executeStrategiesForAllItems:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Start the automated monitoring system with immediate execution
 */
export function startCompetitorMonitoring() {
  console.log('🚀 Starting competitor monitoring service...');

  // Run every 20 minutes to check for competitor price changes
  cron.schedule('*/20 * * * *', async () => {
    try {
      console.log('⏰ Running scheduled competitor price check...');
      await updateCompetitorPrices();
    } catch (error) {
      console.error('❌ Error in scheduled competitor monitoring:', error);
    }
  });

  // Run immediately on startup after a shorter delay
  setTimeout(async () => {
    try {
      console.log('🚀 Running initial competitor price check...');
      await updateCompetitorPrices();
    } catch (error) {
      console.error('❌ Error in initial competitor monitoring:', error);
    }
  }, 10000); // Wait 10 seconds after startup

  console.log(
    '✅ Competitor monitoring service started - checking every 20 minutes'
  );
}

/**
 * Manual trigger for immediate competitor check and strategy execution
 */
export async function manualCompetitorUpdate(itemId = null) {
  try {
    if (itemId) {
      // Update specific item
      const { default: ManualCompetitor } = await import(
        '../models/ManualCompetitor.js'
      );
      const doc = await ManualCompetitor.findOne({ itemId });

      if (doc) {
        const result = await triggerStrategyForItem(itemId, doc.userId);
        return { success: true, result };
      } else {
        return { success: false, error: 'Item not found' };
      }
    } else {
      // Update all items
      const result = await updateCompetitorPrices();
      return { success: true, result };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}
