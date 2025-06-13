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

// Models (if you need to attach models to `app.locals` or `app.set('models', {...})`)
import PriceHistory from './models/PriceHistory.js';

dotenv.config();
const app = express();

// ── Connect to MongoDB ─────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
  })
  .catch((err) => {
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

// If you want to make models available to controllers via `req.app.get('models')`:
app.set('models', { PriceHistory });

// ── Mounting All Routers ───────────────────────────────────────────────────────

// 1) Authentication (login, register, logout, OAuth callback, etc.)
app.use('/auth', authRoutes);

// 2) eBay "fetch‐and‐edit" routes (listings, policies, competitor‐prices, etc.)
app.use('/api/ebay', ebayRoutes);

// 3) Sync service (auto‐sync listings)
app.use('/api/sync', syncRoutes);

// 4) Pricing‐strategies endpoints (create/update/delete strategies, apply to items, etc.)
app.use('/api/pricing-strategies', pricingStrategiesRouter);

// 5) Price-history endpoints (history/:itemId, analytics/:itemId, export/:itemId)
app.use('/api/price-history', priceHistoryRoutes); // Add price history routes

// 6) Competitor‐rules endpoints (create/edit/delete competitor rules, debug, etc.)
app.use('/api/competitor-rules', competitorRulesRouter);

// ── Basic sanity check endpoint ─────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    message: 'eBay Auth & API Service is running',
    endpoints: {
      user_auth_flow: [
        '/auth/login',
        '/auth/register',
        '/auth/ebay-login',
        '/auth/generate-code',
        '/auth/automated-login',
      ],
      get_token: '/auth/token',
      application_token: '/auth/application_token',
      refresh_token: '/auth/refresh',
      api_docs: '/api-docs',
    },
  });
});

// ── Start the server ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
});

