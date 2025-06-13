import cron from 'node-cron';
import { executeAllActiveStrategies } from './strategyService.js';

/**
 * Start the pricing strategy scheduler
 * This will run every hour to check competitor prices and update accordingly
 */
export function startPricingScheduler() {
  console.log('🕐 Starting pricing strategy scheduler...');

  // Run every hour at minute 0
  cron.schedule(
    '0 * * * *',
    async () => {
      try {
        console.log('⏰ Scheduled execution of pricing strategies started');
        const results = await executeAllActiveStrategies();
        console.log('⏰ Scheduled execution completed:', results);
      } catch (error) {
        console.error('❌ Error in scheduled strategy execution:', error);
      }
    },
    {
      scheduled: true,
      timezone: 'America/New_York', // Adjust to your timezone
    }
  );

  // Also run every 15 minutes during business hours (9 AM - 6 PM EST)
  cron.schedule(
    '*/15 9-18 * * *',
    async () => {
      try {
        console.log(
          '⏰ Business hours execution of pricing strategies started'
        );
        const results = await executeAllActiveStrategies();
        console.log('⏰ Business hours execution completed:', results);
      } catch (error) {
        console.error('❌ Error in business hours strategy execution:', error);
      }
    },
    {
      scheduled: true,
      timezone: 'America/New_York',
    }
  );

  console.log('✅ Pricing strategy scheduler started successfully');
}

/**
 * Stop the pricing strategy scheduler
 */
export function stopPricingScheduler() {
  cron.destroy();
  console.log('🛑 Pricing strategy scheduler stopped');
}
