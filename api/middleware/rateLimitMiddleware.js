import ebayUsageService from '../services/ebayUsageService.js';

// In-memory rate limiting for immediate protection
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_CALLS_PER_MINUTE = {
  GetItem: 10,
  GetMyeBaySelling: 5,
  ReviseInventoryStatus: 10,
  default: 5,
};

/**
 * Rate limiting middleware for eBay API calls
 */
export const ebayRateLimit = (callName = 'GetItem') => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id || req.query.userId || req.body.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'User authentication required for rate limiting',
        });
      }

      // Check immediate rate limiting first (prevent spam)
      const rateLimitKey = `${userId}_${callName}`;
      const now = Date.now();
      const userRateData = rateLimitStore.get(rateLimitKey) || {
        calls: [],
        lastReset: now,
      };

      // Clean old calls (older than 1 minute)
      userRateData.calls = userRateData.calls.filter(
        (callTime) => now - callTime < RATE_LIMIT_WINDOW
      );

      const maxCalls =
        MAX_CALLS_PER_MINUTE[callName] || MAX_CALLS_PER_MINUTE.default;

      if (userRateData.calls.length >= maxCalls) {
        console.warn(
          `🚫 Rate limit exceeded for ${userId} - ${callName}: ${userRateData.calls.length}/${maxCalls} calls in last minute`
        );
        return res.status(429).json({
          success: false,
          message: `Rate limit exceeded for ${callName}. Max ${maxCalls} calls per minute.`,
          retryAfter: 60,
          callsInLastMinute: userRateData.calls.length,
          maxCallsPerMinute: maxCalls,
        });
      }

      // Check eBay API limits
      const permission = await ebayUsageService.canMakeAPICall(
        userId,
        callName
      );

      if (!permission.allowed) {
        console.warn(
          `🚫 eBay API limit exceeded for ${userId} - ${callName}:`,
          permission.message
        );
        return res.status(429).json({
          success: false,
          message: permission.message,
          reason: permission.reason,
          resetTime: permission.resetTime,
          retryAfter: 3600, // 1 hour default
        });
      }

      // Record this call
      userRateData.calls.push(now);
      rateLimitStore.set(rateLimitKey, userRateData);

      // Add usage info to request for logging
      req.ebayUsage = {
        apiCall: callName,
        timestamp: new Date().toISOString(),
        dailyRemaining: permission.dailyRemaining,
        hourlyRemaining: permission.hourlyRemaining,
        rateLimitStatus: 'allowed',
      };

      next();
    } catch (error) {
      console.error(`Rate limiting error for ${callName}:`, error);
      // Allow request to proceed but log the error
      req.ebayUsage = {
        apiCall: callName,
        timestamp: new Date().toISOString(),
        error: error.message,
        rateLimitStatus: 'error_allowing',
      };
      next();
    }
  };
};

/**
 * Middleware to log API usage after request
 */
export const logEbayUsage = (req, res, next) => {
  // Log the usage after response
  res.on('finish', () => {
    if (req.ebayUsage) {
      console.log(`📊 eBay API Usage:`, {
        ...req.ebayUsage,
        statusCode: res.statusCode,
        userId: req.user?.id || req.query.userId || 'unknown',
      });
    }
  });
  next();
};

// Clean up old rate limit data periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    data.calls = data.calls.filter(
      (callTime) => now - callTime < RATE_LIMIT_WINDOW
    );
    if (data.calls.length === 0) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000); // Clean every 5 minutes
