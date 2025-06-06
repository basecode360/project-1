// services/historyService.js

import PriceHistory from '../models/PriceHistory.js';

/**
 * Record a new price change.
 *
 * @param {Object} params
 *   - userId:        ObjectId of the user (multi-user support)
 *   - itemId:        String eBay ItemID
 *   - sku:           String SKU (variation) or null
 *   - title:         String (item title at time of change)
 *   - oldPrice:      Number (previous price) or null
 *   - newPrice:      Number (required)
 *   - currency:      String (e.g. 'USD'), default 'USD'
 *
 *   // NEW FIELDS:
 *   - competitorLowestPrice: Number (lowest competitor price at time of repricing)
 *   - strategyName:         String (name of pricing strategy used, e.g. 'BeatBy0.50')
 *   - status:               String enum('Done','Skipped','Error','Manual') – required
 *
 *   - source:        String enum('api','manual','system'), default 'api'
 *   - apiResponse:   Mixed, default null (raw API payload if any)
 *   - success:       Boolean, required (did the price update succeed?)
 *   - error:         Mixed, default null (error details if success===false)
 *   - metadata:      Mixed, default {} (any extra metadata)
 *
 * Automatically computes:
 *   - changeAmount   = newPrice − oldPrice (if oldPrice provided)
 *   - changePercentage = (changeAmount / oldPrice) × 100  (if oldPrice > 0)
 *   - changeDirection  = 'increased' | 'decreased' | 'unchanged' | null
 *
 * Returns the saved PriceHistory document.
 */
export async function recordPriceChange({
  userId,
  itemId,
  sku,
  title = null,
  oldPrice = null,
  newPrice,
  currency = 'USD',
  competitorLowestPrice = null, // <–– new
  strategyName = null, // <–– new
  status, // <–– new (required)
  source = 'api',
  apiResponse = null,
  success,
  error = null,
  metadata = {},
}) {
  if (
    !itemId ||
    sku == null ||
    newPrice == null ||
    status == null ||
    success == null
  ) {
    throw new Error(
      'itemId, sku, newPrice, status, and success are all required.'
    );
  }

  const changeAmount =
    oldPrice != null ? Number(newPrice) - Number(oldPrice) : null;

  let changePercentage = null;
  if (oldPrice != null && oldPrice > 0) {
    changePercentage = Number(
      ((changeAmount / Number(oldPrice)) * 100).toFixed(2)
    );
  }

  let changeDirection = null;
  if (changeAmount != null) {
    if (changeAmount > 0) changeDirection = 'increased';
    else if (changeAmount < 0) changeDirection = 'decreased';
    else changeDirection = 'unchanged';
  }

  const record = new PriceHistory({
    userId,
    itemId,
    sku,
    title,
    oldPrice: oldPrice != null ? Number(oldPrice) : null,
    newPrice: Number(newPrice),
    currency,
    changeAmount: changeAmount != null ? Number(changeAmount) : null,
    changePercentage:
      changePercentage != null ? Number(changePercentage) : null,
    changeDirection,
    competitorLowestPrice:
      competitorLowestPrice != null ? Number(competitorLowestPrice) : null,
    strategyName: strategyName || null,
    status,
    source,
    apiResponse,
    success,
    error,
    metadata,
  });

  return await record.save();
}

/**
 * Retrieve raw price-history entries for an item (and optional SKU).
 *
 * @param {Object} params
 *   - itemId: String eBay ItemID
 *   - sku:    String SKU (or null to get all SKUs)
 *   - limit:  Number maximum entries to return (default: 100)
 */
export async function fetchRawPriceHistory({
  itemId,
  sku = null,
  limit = 100,
}) {
  if (!itemId) {
    throw new Error('itemId is required');
  }
  const query = { itemId };
  if (sku) query.sku = sku;

  return await PriceHistory.find(query).sort({ createdAt: -1 }).limit(limit);
}

/**
 * Retrieve analytics for a given itemId (and optional SKU) over a time window.
 *
 * @param {Object} params
 *   - itemId: String eBay ItemID
 *   - sku:    String SKU (or null)
 *   - period: String in { '7d'|'30d'|'90d'|'1y'|'all' } (default: '30d')
 *
 * Returns an object:
 *   {
 *     itemId,
 *     sku,
 *     period,
 *     startDate,
 *     endDate,
 *     priceAtStart,
 *     currentPrice,
 *     totalChange,
 *     percentChange,
 *     totalRecords,
 *     changeFrequency,
 *     pricePoints: [ { price, date, changeAmount, changePercentage }... ]
 *   }
 */
export async function getPriceAnalytics({
  itemId,
  sku = null,
  period = '30d',
}) {
  if (!itemId) {
    throw new Error('itemId is required');
  }

  // Determine date range
  const endDate = new Date();
  const startDate = new Date();
  switch (period) {
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
      startDate.setTime(0);
      break;
    default:
      startDate.setDate(startDate.getDate() - 30);
  }

  // Build query
  const query = {
    itemId,
    success: true,
    createdAt: { $gte: startDate, $lte: endDate },
  };
  if (sku) {
    query.sku = sku;
  }

  // Fetch matching records
  const records = await PriceHistory.find(query).sort({ createdAt: 1 });

  if (records.length === 0) {
    return {
      itemId,
      sku,
      period,
      startDate,
      endDate,
      message: 'No price records found in this period',
      totalRecords: 0,
      pricePoints: [],
    };
  }

  const first = records[0];
  const last = records[records.length - 1];
  const priceAtStart = first.newPrice;
  const currentPrice = last.newPrice;
  const totalChange = Number((currentPrice - priceAtStart).toFixed(2));
  const percentChange =
    priceAtStart > 0
      ? Number(((totalChange / priceAtStart) * 100).toFixed(2))
      : null;

  const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  const totalRecords = records.length;
  const pricePoints = records.map((r) => ({
    price: r.newPrice,
    date: r.createdAt,
    changeAmount: r.changeAmount,
    changePercentage: r.changePercentage,
  }));
  const changeFrequency =
    totalRecords > 1
      ? `${(totalRecords / days).toFixed(2)} changes per day`
      : 'No changes';

  return {
    itemId,
    sku,
    period,
    startDate,
    endDate,
    priceAtStart,
    currentPrice,
    totalChange,
    percentChange,
    totalRecords,
    changeFrequency,
    pricePoints,
  };
}
