// Create a schema for manually added competitors
import mongoose from 'mongoose';

const manualCompetitorSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  itemId: {
    type: String,
    required: true,
    index: true,
  },
  competitors: [
    {
      competitorItemId: {
        type: String,
        required: true,
      },
      title: {
        type: String,
        required: true,
      },
      price: {
        type: Number,
        required: true,
      },
      currency: {
        type: String,
        default: 'USD',
      },
      imageUrl: {
        type: String,
      },
      productUrl: {
        type: String,
        required: true,
      },
      locale: {
        type: String,
        default: 'US',
      },
      condition: {
        type: String,
      },
      addedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Create compound index for efficient queries
manualCompetitorSchema.index({ userId: 1, itemId: 1 }, { unique: true });

// Update the updatedAt field on save
manualCompetitorSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

const ManualCompetitor = mongoose.model(
  'ManualCompetitor',
  manualCompetitorSchema
);

export default ManualCompetitor;
