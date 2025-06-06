// app.js

import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import morgan from 'morgan';
import cors from 'cors';

// Routes
import syncRoutes from './routes/syncRoute.js';
import ebayRoutes from './routes/ebayRoutes.js';
import authRoutes from './routes/authRoute.js';
import pricingStrategiesRouter from './routes/pricingStrategies.js';
import priceHistoryRoutes from './routes/priceHistoryRoutes.js';
import competitorRulesRouter from './routes/competitorRule.js';

import {
  generateEbayAuthCode,
  generateCodeMiddleware,
} from './controllers/middleware/authenticateUser.js';

// Models (if you need to attach models to `app.locals` or `app.set('models', {...})`)
import PriceHistory from './models/PriceHistory.js';

dotenv.config();
const app = express();

// ── Connect to MongoDB ─────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
  })
  .catch((err) => {
    console.error('❌ Error connecting to MongoDB:', err);
  });

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(
  cors({
    origin: '*',
    credentials: true,
  })
);
app.use(morgan('short'));

app.use('/auth', authRoutes);

// If you want to make models available to controllers via `req.app.get('models')`:
app.set('models', { PriceHistory });

// ── Swagger setup (if still needed) ────────────────────────────────────────────
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'eBay Inventory API',
      version: '1.0.0',
      description: 'API for eBay Inventory',
    },
    servers: [
      {
        url: 'http://localhost:5000/api/ebay',
      },
    ],
  },
  apis: ['./routes/*.js'],
};
const swaggerSpec = swaggerJSDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── Mounting All Routers ───────────────────────────────────────────────────────

// 1) eBay “fetch‐and‐edit” routes (listings, policies, competitor‐prices, etc.)
app.use('/api/ebay', ebayRoutes);

// 2) Sync service (auto‐sync listings)
app.use('/api/sync', syncRoutes);

// 3) Authentication (login, register, logout, OAuth callback, etc.)
app.use('/api/auth', authRoutes);

// 4) Pricing‐strategies endpoints (create/update/delete strategies, apply to items, etc.)
app.use('/api/ebay/pricing-strategies', pricingStrategiesRouter);

// 5) Price-history endpoints (history/:itemId, analytics/:itemId, export/:itemId)
app.use('/api/ebay', priceHistoryRoutes);

// 6) Competitor‐rules endpoints (create/edit/delete competitor rules, debug, etc.)
app.use('/api/competitor-rules', competitorRulesRouter);

// ── eBay OAuth Helper Routes ──────────────────────────────────────────────────

// 7) Step 1 of user‐consent flow: Redirect to eBay’s authorization page
app.get('/auth/login', (req, res) => {
  const clientId = process.env.CLIENT_ID;
  const redirect = encodeURIComponent(process.env.REDIRECT_URI);

  const scopes = encodeURIComponent(
    [
      'https://api.ebay.com/oauth/api_scope',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.account',
      'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    ].join(' ')
  );

  const authUrl =
    `https://auth.ebay.com/oauth2/authorize` +
    `?client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${redirect}` +
    `&scope=${scopes}`;
  console.log('Redirecting to eBay login:', authUrl);
  res.redirect(authUrl);
});

// 8) (Optional) Step 2: “Generate a code automatically” for testing
app.get('/auth/generate-code', generateCodeMiddleware);

// 9) (Optional) Step 2 alternative: “Request an auth code programmatically”
//    and then exchange it for tokens
app.get('/auth/automated-login', async (req, res) => {
  try {
    const code = await generateEbayAuthCode();
    // exchangeCodeForTokens() is defined below
    const tokens = await exchangeCodeForTokens(code);
    res.json({ success: true, ...tokens });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to generate tokens',
      error: error.message,
    });
  }
});

// ── Token Management / “Get Token” Endpoints ────────────────────────────────────

const tokenManager = {
  tokens: { accessToken: null, refreshToken: null, expiryTime: null },

  init() {
    this.tokens.accessToken = process.env.AUTH_TOKEN || null;
    this.tokens.refreshToken = process.env.REFRESH_TOKEN || null;
    // If you stored expiry in ENV
    this.tokens.expiryTime = process.env.AUTH_TOKEN_EXPIRY
      ? new Date(process.env.AUTH_TOKEN_EXPIRY)
      : null;
    console.log(
      'Token manager initialized:',
      this.tokens.accessToken ? '[accessToken exists]' : '[no accessToken]',
      this.tokens.refreshToken ? '[refreshToken exists]' : ''
    );
  },

  updateTokens(accessToken, refreshToken, expiresIn) {
    this.tokens.accessToken = accessToken;
    if (refreshToken) this.tokens.refreshToken = refreshToken;
    this.tokens.expiryTime = new Date(Date.now() + expiresIn * 1000);

    process.env.AUTH_TOKEN = accessToken;
    if (refreshToken) process.env.REFRESH_TOKEN = refreshToken;
    process.env.AUTH_TOKEN_EXPIRY = this.tokens.expiryTime.toISOString();

    console.log('Tokens updated; new expiry:', this.tokens.expiryTime);
  },

  isTokenValid() {
    if (!this.tokens.accessToken || !this.tokens.expiryTime) return false;
    const now = new Date();
    const fiveMinutesLater = new Date(now.getTime() + 5 * 60 * 1000);
    return this.tokens.expiryTime > fiveMinutesLater;
  },
};

tokenManager.init();

// 10) GET /auth/token → return user’s stored token (refresh if needed)
app.get('/auth/token', async (req, res) => {
  try {
    if (tokenManager.isTokenValid()) {
      return res.json({
        success: true,
        auth_token: tokenManager.tokens.accessToken,
        expires_at: tokenManager.tokens.expiryTime,
        expires_in_seconds: Math.floor(
          (tokenManager.tokens.expiryTime - new Date()) / 1000
        ),
      });
    }

    if (tokenManager.tokens.refreshToken) {
      try {
        const auth = await refreshAccessToken();
        return res.json(auth);
      } catch (error) {
        console.error('Token refresh error:', error);
        // fall through to client‐credentials
      }
    }

    // Fall back to client‐credentials flow
    const auth = await getApplicationToken();
    return res.json(auth);
  } catch (error) {
    console.error('Auth token endpoint error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get auth token',
      error: error.message || error,
    });
  }
});

// 11) GET /auth/application_token → generate a client‐credentials token
app.get('/auth/application_token', async (req, res) => {
  try {
    const auth = await getApplicationToken();
    return res.json(auth);
  } catch (error) {
    console.error('Application token error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get application token',
      error: error.message || error,
    });
  }
});

// 12) GET /auth/refresh → manually refresh user’s token
app.get('/auth/refresh', async (req, res) => {
  if (!tokenManager.tokens.refreshToken) {
    return res.status(400).json({
      success: false,
      message:
        'No refresh token available. Please complete the authorization flow first.',
      auth_url: '/auth/login',
    });
  }
  try {
    const auth = await refreshAccessToken();
    return res.json(auth);
  } catch (error) {
    console.error('Token refresh error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to refresh token',
      error: error.message || error,
      auth_url: '/auth/login',
    });
  }
});

// ── Helper functions for the above endpoints ──────────────────────────────────

import qs from 'qs';
import axios from 'axios';

/**
 * Exchange authorization code for tokens,
 * then store them in tokenManager + ENV.
 */
async function exchangeCodeForTokens(code) {
  const creds = Buffer.from(
    `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
  ).toString('base64');

  const body = qs.stringify({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.REDIRECT_URI,
  });

  const { data } = await axios.post(
    `https://api.ebay.com/identity/v1/oauth2/token`,
    body,
    {
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  const { access_token, refresh_token, expires_in } = data;
  tokenManager.updateTokens(access_token, refresh_token, expires_in);

  return {
    success: true,
    auth_token: access_token,
    refresh_token,
    expires_at: tokenManager.tokens.expiryTime,
    expires_in_seconds: expires_in,
    token_type: 'user_token',
  };
}

/**
 * Refresh the user’s existing token using refresh_token, and update tokenManager.
 */
async function refreshAccessToken() {
  const creds = Buffer.from(
    `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
  ).toString('base64');

  const body = qs.stringify({
    grant_type: 'refresh_token',
    refresh_token: tokenManager.tokens.refreshToken,
    scope: [
      'https://api.ebay.com/oauth/api_scope',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.account',
      'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    ].join(' '),
  });

  const { data } = await axios.post(
    `https://api.ebay.com/identity/v1/oauth2/token`,
    body,
    {
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  const { access_token, refresh_token, expires_in } = data;
  tokenManager.updateTokens(access_token, refresh_token, expires_in);

  return {
    success: true,
    auth_token: access_token,
    expires_at: tokenManager.tokens.expiryTime,
    expires_in_seconds: expires_in,
    token_type: 'user_token',
  };
}

/**
 * Client‐credentials flow for application tokens (no user context).
 */
async function getApplicationToken() {
  const creds = Buffer.from(
    `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
  ).toString('base64');

  const body = qs.stringify({
    grant_type: 'client_credentials',
    scope: 'https://api.ebay.com/oauth/api_scope',
  });

  const { data } = await axios.post(
    `https://api.ebay.com/identity/v1/oauth2/token`,
    body,
    {
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  const { access_token, expires_in } = data;
  tokenManager.updateTokens(access_token, null, expires_in);

  return {
    success: true,
    auth_token: access_token,
    expires_at: tokenManager.tokens.expiryTime,
    expires_in_seconds: expires_in,
    token_type: 'application_token',
    note: 'This token can only be used for APIs that do not require user consent.',
  };
}

// ── Basic sanity check endpoint ─────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    message: 'eBay Auth & API Service is running',
    endpoints: {
      user_auth_flow: [
        '/auth/login',
        '/auth/generate-code',
        '/auth/automated-login',
      ],
      get_token: '/auth/token',
      application_token: '/auth/application_token',
      refresh_token: '/auth/refresh',
    },
  });
});

// ── Start the server ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
