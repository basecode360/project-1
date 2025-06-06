// models/PriceHistory.js

import mongoose from 'mongoose';

const priceHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  // eBay ItemID
  itemId: {
    type: String,
    required: true,
    index: true,
  },

  // Variation SKU (or null if no variation)
  sku: {
    type: String,
    required: true,
    index: true,
  },

  // The item’s title at time of change
  title: {
    type: String,
    default: null,
  },

  // Price before the change
  oldPrice: {
    type: Number,
    default: null,
  },

  // Price after the change
  newPrice: {
    type: Number,
    required: true,
  },

  // Currency code (e.g. USD)
  currency: {
    type: String,
    default: 'USD',
  },

  // How many % changed compared to oldPrice
  changePercentage: {
    type: Number,
    default: null,
  },

  // Absolute difference: newPrice − oldPrice
  changeAmount: {
    type: Number,
    default: null,
  },

  // “increased” / “decreased” / “unchanged” / null
  changeDirection: {
    type: String,
    enum: ['increased', 'decreased', 'unchanged', null],
    default: null,
  },

  // **New field:** the lowest competitor price that was used
  competitorLowestPrice: {
    type: Number,
    default: null,
  },

  // **New field:** the string name of the pricing strategy used (e.g. “BeatBy0.50”)
  strategyName: {
    type: String,
    default: null,
  },

  // **New field:** status of this update (“Done”, “Skipped”, “Error” etc.)
  status: {
    type: String,
    enum: ['Done', 'Skipped', 'Error', 'Manual'],
    required: true,
  },

  // “api” / “manual” / “system”
  source: {
    type: String,
    enum: ['api', 'manual', 'system'],
    default: 'api',
  },

  // Raw API payload or error details (if any)
  apiResponse: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },

  // Boolean: did the price‐change attempt succeed?
  success: {
    type: Boolean,
    required: true,
  },

  // If success===false, any error object
  error: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },

  // Free‐form metadata (optional)
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },

  // Timestamp
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Compound index to optimize lookups by itemId/sku/date
priceHistorySchema.index({ itemId: 1, sku: 1, createdAt: -1 });

const PriceHistory = mongoose.model('PriceHistory', priceHistorySchema);
export default PriceHistory;
