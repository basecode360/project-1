// models/PriceHistory.js
import mongoose from 'mongoose';

const priceHistorySchema = new mongoose.Schema({
  itemId: {
    type: String,
    required: true,
    index: true
  },
  sku: {
    type: String,
    required: true,
    index: true
  },
  title: {
    type: String,
    default: null
  },
  oldPrice: {
    type: Number,
    default: null
  },
  newPrice: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'USD'
  },
  changePercentage: {
    type: Number,
    default: null
  },
  changeAmount: {
    type: Number,
    default: null
  },
  changeDirection: {
    type: String,
    enum: ['increased', 'decreased', 'unchanged', null],
    default: null
  },
  source: {
    type: String,
    enum: ['api', 'manual', 'system'],
    default: 'api'
  },
  apiResponse: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  success: {
    type: Boolean,
    required: true
  },
  error: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Create compound index for efficient queries
priceHistorySchema.index({ itemId: 1, sku: 1, createdAt: -1 });

// Virtual for price change percentage calculation
priceHistorySchema.virtual('priceChangePercentage').get(function() {
  if (!this.oldPrice || this.oldPrice === 0) return null;
  return ((this.newPrice - this.oldPrice) / this.oldPrice) * 100;
});

// Instance method to get next price change
priceHistorySchema.methods.getNextPriceChange = async function() {
  return this.model('PriceHistory').findOne({
    itemId: this.itemId,
    sku: this.sku,
    createdAt: { $gt: this.createdAt }
  }).sort({ createdAt: 1 });
};

// Static method to get price history for an item
priceHistorySchema.statics.getItemPriceHistory = async function(itemId, sku = null, limit = 10) {
  const query = { itemId };
  if (sku) query.sku = sku;
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Static method to get latest price for an item
priceHistorySchema.statics.getLatestPrice = async function(itemId, sku) {
  return this.findOne({ itemId, sku, success: true })
    .sort({ createdAt: -1 });
};

const PriceHistory = mongoose.model('PriceHistory', priceHistorySchema);

export default PriceHistory;