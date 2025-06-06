// routes/authRoute.js
import express from 'express';
import Joi from 'joi';
import User from '../models/Users.js';
import sendResponse from '../helper/sendResponse.js'; // utility for consistent JSON replies
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Import our eBay‐OAuth helpers
import {
  exchangeCodeForToken,
  refreshUserAccessToken,
} from '../services/ebayAuthService.js';

const router = express.Router();

// ─── Health check or placeholder ───────────────────────────────
router.get('/', (req, res) => {
  return res.status(200).json({
    success: true,
    message:
      'Auth service is live. Available endpoints: /register, /login, /exchange-code, /token, /refresh',
  });
});

// ─── Validation schema for register/login ───────────────────────
const loginSchema = Joi.object({
  email: Joi.string()
    .email({ minDomainSegments: 2, tlds: ['com', 'net', 'org'] })
    .required(),
  password: Joi.string().min(6).required(),
});

// ─── POST /auth/register ─────────────────────────────────────────
// Create a new user (email + password). The `ebay` sub‐document remains null at first.
router.post('/register', async (req, res) => {
  try {
    // Validate input
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return sendResponse(res, 400, false, error.details[0].message);
    }

    // Check for duplicate email
    const existing = await User.findOne({ email: value.email });
    if (existing) {
      return sendResponse(res, 400, false, 'User already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(value.password, 10);

    // Save new user (ebay.* fields will be null by default)
    const newUser = new User({
      email: value.email,
      password: hashedPassword,
    });
    await newUser.save();

    return sendResponse(res, 201, true, 'User registered successfully', {
      user: { id: newUser._id, email: newUser.email },
    });
  } catch (err) {
    console.error('POST /auth/register error:', err);
    return sendResponse(res, 500, false, 'Registration failed', {
      error: err.message,
    });
  }
});

// ─── POST /auth/login ────────────────────────────────────────────
// Authenticate email/password, return a JWT for your own backend.
router.post('/login', async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return sendResponse(res, 400, false, error.details[0].message);
    }

    // Check fields exist
    if (!value.email || !value.password) {
      return sendResponse(res, 400, false, 'Email and password are required');
    }

    // Find user by email
    const user = await User.findOne({ email: value.email });
    if (!user) {
      return sendResponse(res, 400, false, 'Invalid email or password');
    }

    // Compare password
    const isValid = await bcrypt.compare(value.password, user.password);
    if (!isValid) {
      return sendResponse(res, 400, false, 'Invalid email or password');
    }

    // Remove password field before signing
    const payload = { id: user._id, email: user.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    return sendResponse(res, 200, true, 'Login successful', {
      user: { id: user._id, email: user.email },
      token,
    });
  } catch (err) {
    console.error('POST /auth/login error:', err);
    return sendResponse(res, 500, false, 'Login failed', {
      error: err.message,
    });
  }
});

// ─── POST /auth/exchange-code ─────────────────────────────────────
// Body: { code: string, userId: string }
// Exchanges an eBay OAuth “authorization code” for user‐specific access/refresh tokens.
// Stores the resulting tokens under User.ebay.* fields.
router.post('/exchange-code', async (req, res) => {
  try {
    const { code, userId } = req.body;
    if (!code || !userId) {
      return sendResponse(res, 400, false, 'Both code and userId are required');
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return sendResponse(res, 404, false, 'User not found');
    }

    // Call our helper to exchange code ↠ tokens and save them on user.ebay.*
    const tokens = await exchangeCodeForToken(code, userId);
    // exchangeCodeForToken() itself updates User.ebay.accessToken, refreshToken, expiresAt.

    return sendResponse(res, 200, true, 'Tokens exchanged successfully', {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    });
  } catch (err) {
    console.error('POST /auth/exchange-code error:', err);
    return sendResponse(
      res,
      err.response?.status || 500,
      false,
      err.message || 'Failed to exchange code'
    );
  }
});

// ─── GET /auth/token ───────────────────────────────────────────────
// Returns the current user access token, refreshing it if needed.
// (This endpoint assumes you have some form of “req.user” or you pass userId via query.)
// For now, we'll read userId from a query parameter for demonstration: /auth/token?userId=<...>
router.get('/token', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return sendResponse(res, 400, false, 'Missing userId in query');
    }

    // Fetch user and check if an eBay refresh token exists
    const user = await User.findById(userId).select(
      'ebay.refreshToken ebay.expiresAt ebay.accessToken'
    );
    if (!user) {
      return sendResponse(res, 404, false, 'User not found');
    }
    if (!user.ebay.refreshToken) {
      return sendResponse(
        res,
        400,
        false,
        'No refresh token available—authorize first'
      );
    }

    // If token is still valid (5 min buffer)
    const now = Date.now();
    const expiresAt = user.ebay.expiresAt ? user.ebay.expiresAt.getTime() : 0;
    if (expiresAt > now + 5 * 60 * 1000) {
      // Still more than 5 minutes before expiry
      return sendResponse(res, 200, true, 'Token still valid', {
        access_token: user.ebay.accessToken,
        expires_at: user.ebay.expiresAt,
        expires_in_seconds: Math.floor((expiresAt - now) / 1000),
      });
    }

    // Otherwise, refresh it now
    const newTokens = await refreshUserAccessToken(userId);
    // refreshUserAccessToken() updates user.ebay.accessToken, refreshToken (if rotated), expiresAt

    return sendResponse(res, 200, true, 'Token refreshed successfully', {
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token || user.ebay.refreshToken,
      expires_at: user.ebay.expiresAt,
      expires_in_seconds: newTokens.expires_in,
    });
  } catch (err) {
    console.error('GET /auth/token error:', err);
    return sendResponse(res, 500, false, 'Failed to fetch or refresh token', {
      error: err.message,
    });
  }
});

// ─── GET /auth/refresh ─────────────────────────────────────────────
// Force‐refresh the user’s eBay access token, regardless of remaining time.
// Body or Query: userId=<…>
router.get('/refresh', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return sendResponse(res, 400, false, 'Missing userId in query');
    }

    // Check if user has a refresh token
    const user = await User.findById(userId).select('ebay.refreshToken');
    if (!user || !user.ebay.refreshToken) {
      return sendResponse(
        res,
        400,
        false,
        'No refresh token available—authorize first'
      );
    }

    const newTokens = await refreshUserAccessToken(userId);
    return sendResponse(res, 200, true, 'Token refreshed successfully', {
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token || user.ebay.refreshToken,
      expires_at: user.ebay.expiresAt,
      expires_in_seconds: newTokens.expires_in,
    });
  } catch (err) {
    console.error('GET /auth/refresh error:', err);
    return sendResponse(res, 500, false, 'Failed to refresh token', {
      error: err.message,
    });
  }
});

export default router;
