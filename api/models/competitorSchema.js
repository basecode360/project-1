// models/CompetitorRule.js
import mongoose from 'mongoose';

const competitorRuleSchema = new mongoose.Schema({
  // Basic Rule Information
  ruleId: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
    index: true
  },
  ruleName: {
    type: String,
    required: [true, 'Rule name is required'],
    trim: true,
    maxlength: [100, 'Rule name cannot exceed 100 characters'],
    index: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  
  // Price Filtering Options
  minPercentOfCurrentPrice: {
    type: Number,
    min: [0, 'Minimum percentage cannot be negative'],
    max: [1000, 'Minimum percentage cannot exceed 1000%'],
    default: 0 // No minimum by default
  },
  maxPercentOfCurrentPrice: {
    type: Number,
    min: [0, 'Maximum percentage cannot be negative'],
    max: [1000, 'Maximum percentage cannot exceed 1000%'],
    default: 1000 // 10x maximum by default
  },
  
  // Location Exclusions
  excludeCountries: {
    type: [String],
    default: []
  },
  
  // Condition Exclusions
  excludeConditions: {
    type: [String],
    default: [],
    validate: {
      validator: function(conditions) {
        const validConditions = [
          'New', 'New with tags', 'New with box', 'New without tags', 
          'Used', 'Used, Excellent', 'Used, Very Good', 'Used, Good', 'Used, Acceptable',
          'For parts or not working', 'Refurbished', 'Open box', 'Certified Refurbished'
        ];
        
        return conditions.every(condition => validConditions.includes(condition));
      },
      message: props => `${props.value} contains invalid item conditions`
    }
  },
  
  // Title Word Exclusions
  excludeProductTitleWords: {
    type: [String],
    default: []
  },
  
  // Seller Exclusions
  excludeSellers: {
    type: [String],
    default: []
  },
  
  // Matching Options
  findCompetitorsBasedOnMPN: {
    type: Boolean,
    default: false
  },
  
  // Advanced Filtering Options
  minSellerFeedbackScore: {
    type: Number,
    min: [0, 'Minimum seller feedback score cannot be negative'],
    default: 0
  },
  minSellerFeedbackPercent: {
    type: Number,
    min: [0, 'Minimum seller feedback percentage cannot be negative'],
    max: [100, 'Maximum seller feedback percentage cannot exceed 100%'],
    default: 0
  },
  excludeTopRatedSellers: {
    type: Boolean,
    default: false
  },
  excludeInternationalSellers: {
    type: Boolean,
    default: false
  },
  
  // Shipping Options
  excludeFreeShipping: {
    type: Boolean,
    default: false
  },
  maxShippingCost: {
    type: Number,
    min: [0, 'Maximum shipping cost cannot be negative'],
    default: null
  },
  
  // Rule Application Settings
  isActive: {
    type: Boolean,
    default: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  appliesTo: {
    type: [{
      itemId: {
        type: String,
        required: true
      },
      sku: String,
      title: String,
      dateApplied: {
        type: Date,
        default: Date.now
      }
    }],
    default: []
  },
  
  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: {
    type: Date
  },
  usageCount: {
    type: Number,
    default: 0
  },
  executionStats: {
    type: {
      totalCompetitorsFound: {
        type: Number,
        default: 0
      },
      competitorsExcluded: {
        type: Number,
        default: 0
      },
      lastExecution: {
        type: Date
      },
      executionHistory: [{
        date: Date,
        itemId: String,
        sku: String,
        competitorsFound: Number,
        competitorsExcluded: Number,
        finalCompetitorsUsed: Number
      }]
    },
    default: {
      totalCompetitorsFound: 0,
      competitorsExcluded: 0
    }
  }
});

// Create indexes for better performance
competitorRuleSchema.index({ isActive: 1 });
competitorRuleSchema.index({ isDefault: 1 });
competitorRuleSchema.index({ 'appliesTo.itemId': 1 });

// Update the updatedAt field on save
competitorRuleSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Validate min/max price percentages
competitorRuleSchema.pre('validate', function(next) {
  if (this.minPercentOfCurrentPrice > this.maxPercentOfCurrentPrice) {
    return next(new Error('Minimum percentage cannot be greater than maximum percentage'));
  }
  next();
});

// Instance method to apply rule to an item
competitorRuleSchema.methods.applyToItem = function(itemId, sku, title) {
  // Check if this item is already in the appliesTo array
  const existingIndex = this.appliesTo.findIndex(item => 
    item.itemId === itemId && ((!sku && !item.sku) || item.sku === sku)
  );
  
  if (existingIndex === -1) {
    this.appliesTo.push({
      itemId,
      sku,
      title,
      dateApplied: new Date()
    });
  } else {
    // Update existing entry
    this.appliesTo[existingIndex].dateApplied = new Date();
    if (title) this.appliesTo[existingIndex].title = title;
  }
  
  return this.save();
};

// Static method to find rule by name
competitorRuleSchema.statics.findByName = function(ruleName) {
  return this.findOne({ ruleName: ruleName });
};

// Static method to get all active rules
competitorRuleSchema.statics.getAllActive = function() {
  return this.find({ isActive: true }).sort({ ruleName: 1 });
};

// Static method to get default rule
competitorRuleSchema.statics.getDefault = function() {
  return this.findOne({ isDefault: true });
};

// Static method to find rules for an item
competitorRuleSchema.statics.findForItem = function(itemId, sku) {
  const query = { 'appliesTo.itemId': itemId };
  if (sku) {
    query['appliesTo.sku'] = sku;
  }
  return this.find(query);
};

// Create model
const CompetitorRule = mongoose.model('CompetitorRule', competitorRuleSchema);

export default CompetitorRule;