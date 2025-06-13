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
  competitorLowestPrice = null,
  strategyName = null,
  status,
  source = 'api',
  apiResponse = null,
  success,
  error = null,
  metadata = {},
}) {
  console.log(`📝 💾 recordPriceChange called with:`, {
    userId,
    itemId,
    sku,
    oldPrice,
    newPrice,
    strategyName,
    status,
    success,
  });

  // Check MongoDB connection
  const mongoose = (await import('mongoose')).default;
  console.log(
    `📝 💾 MongoDB connection state: ${mongoose.connection.readyState}`
  );
  console.log(`📝 💾 MongoDB database name: ${mongoose.connection.name}`);
  console.log(`📝 💾 MongoDB host: ${mongoose.connection.host}`);

  // FIX: Allow sku to be null or empty string (not require it to be defined)
  if (!itemId || newPrice == null || status == null || success == null) {
    const errorMsg = 'itemId, newPrice, status, and success are all required.';
    console.error(`📝 ❌ Validation error:`, errorMsg);
    throw new Error(errorMsg);
  }

  // FIX: Handle sku properly - allow null/undefined/empty string
  const cleanSku = sku || null;

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

  console.log(`📝 💾 Creating PriceHistory record in MongoDB...`);

  const record = new PriceHistory({
    userId,
    itemId,
    sku: cleanSku, // Use cleaned SKU
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

  console.log(
    `📝 💾 Record before save:`,
    JSON.stringify(record.toObject(), null, 2)
  );
  console.log(
    `📝 💾 Saving record to MongoDB collection: ${PriceHistory.collection.name}`
  );

  try {
    const savedRecord = await record.save();
    console.log(
      `📝 ✅ SUCCESSFULLY saved to MongoDB! Collection: ${PriceHistory.collection.name}`
    );
    console.log(`📝 ✅ Record ID: ${savedRecord._id}`);
    console.log(
      `📝 ✅ Full saved record:`,
      JSON.stringify(savedRecord.toObject(), null, 2)
    );

    // Verify the save by querying immediately
    const verification = await PriceHistory.findById(savedRecord._id);
    console.log(`📝 ✅ Verification query successful:`, !!verification);

    return savedRecord;
  } catch (saveError) {
    console.error(`📝 ❌ FAILED to save to MongoDB:`, saveError);
    console.error(`📝 ❌ Collection name: ${PriceHistory.collection.name}`);
    console.error(`📝 ❌ MongoDB save error details:`, {
      message: saveError.message,
      code: saveError.code,
      name: saveError.name,
      validationErrors: saveError.errors,
    });
    throw saveError;
  }
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
  console.log(
    `📊 🔍 fetchRawPriceHistory called for itemId: ${itemId}, limit: ${limit}`
  );
  console.log(`📊 🔍 Collection name: ${PriceHistory.collection.name}`);

  // Check MongoDB connection
  const mongoose = (await import('mongoose')).default;
  console.log(
    `📊 🔍 MongoDB connection state: ${mongoose.connection.readyState}`
  );
  console.log(`📊 🔍 MongoDB database name: ${mongoose.connection.name}`);

  if (!itemId) {
    throw new Error('itemId is required');
  }

  const query = { itemId };
  if (sku) query.sku = sku;

  console.log(`📊 🔍 Querying MongoDB with:`, query);

  try {
    // First, let's check ALL collections in the database
    const collections = await mongoose.connection.db.collections();
    console.log(
      `📊 💾 All collections in database:`,
      collections.map((c) => c.collectionName)
    );

    // Check if our collection exists
    const priceHistoryExists = collections.some(
      (c) => c.collectionName === 'pricehistories'
    );
    console.log(`📊 💾 PriceHistory collection exists: ${priceHistoryExists}`);

    // First, let's check if ANY records exist for this itemId
    const totalCount = await PriceHistory.countDocuments({ itemId });
    console.log(
      `📊 💾 Total records in MongoDB for itemId ${itemId}: ${totalCount}`
    );

    // Also check total records in collection
    const totalInCollection = await PriceHistory.countDocuments({});
    console.log(
      `📊 💾 Total records in entire PriceHistory collection: ${totalInCollection}`
    );

    // Let's also check what itemIds exist in the collection
    const uniqueItemIds = await PriceHistory.distinct('itemId');
    console.log(`📊 💾 Unique itemIds in collection:`, uniqueItemIds);

    // If we have records, let's see a sample
    if (totalCount > 0) {
      const sampleRecord = await PriceHistory.findOne({ itemId }).sort({
        createdAt: -1,
      });
      console.log(`📊 💾 Sample record for ${itemId}:`, {
        _id: sampleRecord._id,
        itemId: sampleRecord.itemId,
        newPrice: sampleRecord.newPrice,
        changeAmount: sampleRecord.changeAmount,
        strategyName: sampleRecord.strategyName,
        success: sampleRecord.success,
        createdAt: sampleRecord.createdAt,
      });
    }

    const records = await PriceHistory.find(query)
      .sort({ createdAt: -1 })
      .limit(limit);
    console.log(
      `📊 ✅ Found ${
        records.length
      } records in MongoDB for ${itemId} (query: ${JSON.stringify(query)})`
    );

    if (records.length > 0) {
      console.log(`📊 ✅ Latest record sample:`, {
        _id: records[0]._id,
        itemId: records[0].itemId,
        newPrice: records[0].newPrice,
        changeAmount: records[0].changeAmount,
        strategyName: records[0].strategyName,
        createdAt: records[0].createdAt,
      });
    } else {
      console.log(
        `📊 ⚠️ No records found for itemId ${itemId} with query:`,
        query
      );
    }

    return records;
  } catch (fetchError) {
    console.error(`📊 ❌ Error fetching from MongoDB:`, fetchError);
    throw fetchError;
  }
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

/**
 * Get paginated price history for a product (optimized for 100+ records)
 */
export async function getPaginatedPriceHistory({
  itemId,
  sku = null,
  limit = 100,
  page = 1,
  sortBy = 'createdAt',
  sortOrder = -1,
}) {
  console.log(
    `📊 🔍 getPaginatedPriceHistory: ${itemId}, page: ${page}, limit: ${limit}`
  );

  if (!itemId) {
    throw new Error('itemId is required');
  }

  try {
    // Get total count for pagination
    const query = { itemId };
    if (sku) query.sku = sku;

    const totalRecords = await PriceHistory.countDocuments(query);
    const totalPages = Math.ceil(totalRecords / limit);

    // Get paginated records
    const records = await PriceHistory.getProductHistory(
      itemId,
      sku,
      limit,
      page,
      sortBy,
      sortOrder
    );

    // Get statistics
    const stats = await PriceHistory.getProductStats(itemId, sku);

    console.log(
      `📊 ✅ Retrieved page ${page}/${totalPages} (${records.length}/${totalRecords} records)`
    );

    return {
      records,
      pagination: {
        currentPage: page,
        totalPages,
        totalRecords,
        recordsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      statistics: stats[0] || null,
    };
  } catch (error) {
    console.error(`📊 ❌ Error in getPaginatedPriceHistory:`, error);
    throw error;
  }
}

/**
 * Bulk insert price history records (for batch operations)
 */
export async function bulkInsertPriceHistory(records) {
  console.log(
    `📝 💾 Bulk inserting ${records.length} price history records...`
  );

  try {
    // Validate all records first
    const validatedRecords = records.map((record) => {
      if (
        !record.itemId ||
        record.newPrice === undefined ||
        !record.status ||
        record.success === undefined
      ) {
        throw new Error('Invalid record: missing required fields');
      }

      // Ensure proper data types
      return {
        ...record,
        newPrice: Number(record.newPrice),
        oldPrice: record.oldPrice ? Number(record.oldPrice) : null,
        competitorLowestPrice: record.competitorLowestPrice
          ? Number(record.competitorLowestPrice)
          : null,
        executedAt: record.executedAt || new Date(),
      };
    });

    // Use insertMany for efficiency
    const result = await PriceHistory.insertMany(validatedRecords, {
      ordered: false, // Continue on errors
      rawResult: true,
    });

    console.log(
      `📝 ✅ Bulk inserted ${result.insertedCount} records successfully`
    );

    return {
      success: true,
      insertedCount: result.insertedCount,
      records: result.ops || [],
    };
  } catch (error) {
    console.error(`📝 ❌ Bulk insert error:`, error);
    throw error;
  }
}

/**
 * Archive old price history records (keep recent 1000 per product)
 */
export async function archiveOldPriceHistory(keepRecentCount = 1000) {
  console.log(
    `🗄️ Archiving old price history records (keeping ${keepRecentCount} per product)...`
  );

  try {
    // Get unique itemIds
    const uniqueItems = await PriceHistory.distinct('itemId');
    let totalArchived = 0;

    for (const itemId of uniqueItems) {
      // Get records to archive (oldest first, skip the recent ones)
      const recordsToArchive = await PriceHistory.find({ itemId })
        .sort({ createdAt: -1 })
        .skip(keepRecentCount)
        .select('_id')
        .lean();

      if (recordsToArchive.length > 0) {
        const idsToArchive = recordsToArchive.map((r) => r._id);

        // You could move to archive collection or delete
        // For now, we'll just delete old records
        const deleteResult = await PriceHistory.deleteMany({
          _id: { $in: idsToArchive },
        });

        totalArchived += deleteResult.deletedCount;
        console.log(
          `🗄️ Archived ${deleteResult.deletedCount} records for item ${itemId}`
        );
      }
    }

    console.log(`🗄️ ✅ Total archived: ${totalArchived} records`);
    return { success: true, archivedCount: totalArchived };
  } catch (error) {
    console.error(`🗄️ ❌ Archive error:`, error);
    throw error;
  }
}

/**
 * Get price history summary for dashboard display
 */
export async function getPriceHistorySummary(itemId, sku = null) {
  console.log(`📊 Getting price history summary for ${itemId}`);

  try {
    const query = { itemId, success: true };
    if (sku) query.sku = sku;

    // Get recent records for summary
    const recentRecords = await PriceHistory.find(query)
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    if (recentRecords.length === 0) {
      return {
        hasHistory: false,
        totalChanges: 0,
        latestChange: null,
        currentPrice: null,
        priceDirection: 'unchanged',
      };
    }

    const latestRecord = recentRecords[0];

    return {
      hasHistory: true,
      totalChanges: recentRecords.length,
      latestChange: latestRecord.createdAt,
      currentPrice: latestRecord.newPrice,
      lastChangeAmount: latestRecord.changeAmount,
      priceDirection: latestRecord.changeDirection || 'unchanged',
      lastStrategy: latestRecord.strategyName,
    };
  } catch (error) {
    console.error(`📊 ❌ Error getting price history summary:`, error);
    throw error;
  }
}

/**
 * Clean up old failed price history records
 */
export async function cleanupFailedRecords(daysOld = 30) {
  console.log(`🧹 Cleaning up failed records older than ${daysOld} days...`);

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await PriceHistory.deleteMany({
      success: false,
      createdAt: { $lt: cutoffDate },
    });

    console.log(`🧹 ✅ Cleaned up ${result.deletedCount} failed records`);
    return { success: true, deletedCount: result.deletedCount };
  } catch (error) {
    console.error(`🧹 ❌ Cleanup error:`, error);
    throw error;
  }
}

/**
 * Get price trend analysis for an item
 */
export async function getPriceTrendAnalysis(itemId, sku = null, days = 30) {
  console.log(
    `📈 Getting price trend analysis for ${itemId} over ${days} days`
  );

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const query = {
      itemId,
      success: true,
      createdAt: { $gte: startDate },
    };
    if (sku) {
      query.sku = sku;
    }

    const records = await PriceHistory.find(query)
      .sort({ createdAt: 1 })
      .lean();

    if (records.length === 0) {
      return {
        trend: 'no-data',
        direction: 'unchanged',
        volatility: 0,
        averageChange: 0,
      };
    }

    // Calculate trend metrics
    const prices = records.map((r) => r.newPrice);
    const changes = records
      .map((r) => r.changeAmount)
      .filter((c) => c !== null);

    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const totalChange = lastPrice - firstPrice;
    const percentChange = firstPrice > 0 ? (totalChange / firstPrice) * 100 : 0;

    const averageChange =
      changes.length > 0
        ? changes.reduce((sum, change) => sum + Math.abs(change), 0) /
          changes.length
        : 0;

    let trend = 'stable';
    let direction = 'unchanged';

    if (Math.abs(percentChange) > 10) {
      trend = 'volatile';
    } else if (Math.abs(percentChange) > 5) {
      trend = 'moderate';
    }

    if (totalChange > 0) {
      direction = 'increasing';
    } else if (totalChange < 0) {
      direction = 'decreasing';
    }

    return {
      trend,
      direction,
      totalChange,
      percentChange: Number(percentChange.toFixed(2)),
      volatility: Number(averageChange.toFixed(2)),
      averageChange: Number(averageChange.toFixed(2)),
      dataPoints: records.length,
    };
  } catch (error) {
    console.error(`📈 ❌ Error in price trend analysis:`, error);
    throw error;
  }
}
