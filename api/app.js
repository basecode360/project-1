// api/app.js
import express from 'express';
import mongoose, { get } from 'mongoose';
import dotenv from 'dotenv';
import morgan from 'morgan';
import axios from 'axios';
import qs from 'qs';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express'
import syncRoutes from './routes/syncRoute.js'
import ebayRoutes from './routes/ebayRoutes.js';
import cors from 'cors';
import authRoutes from './routes/authRoute.js';
import pricingRoute from "./routes/pricingEngine.js" 
import { priceTrackerRouter, checkPriceChanges } from "./routes/priceHistory.js";
import competitorRulesRouter  from "./routes/competitorRule.js";



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
        url: 'http://localhost:5000/api/ebay',  // Ensure this is pointing to your local server
      },
    ],
  },
  apis: ['./routes/*.js'],
};
const swaggerSpec = swaggerJSDoc(swaggerOptions);



dotenv.config();

const app = express();


app.use(express.json());
app.use(morgan('short'));
app.use(cors({
  origin: '*',
  credentials:true
}))

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── 1) eBay OAuth Login Redirect ─────────────────────────────────────────────
app.get('/auth/login', (req, res) => {
  const clientId = process.env.CLIENT_ID;
  const redirect = encodeURIComponent(process.env.REDIRECT_URI);
 try {
  const scopes = encodeURIComponent([
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment'
  ].join(' '));

  const authUrl =
    `https://auth.ebay.com/oauth2/authorize` +
    `?client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${redirect}` +
    `&scope=${scopes}`;

  res.redirect(authUrl);
 } catch (error) {
  const errorMessage = error.response ? error.response.data : error.message;
  return res.status(500).json({ error: 'Authorization URL generation failed', details: errorMessage });
 }
});
// ──────────────────────────────────────────────────────────────────────────────

// ── 2) Handle eBay’s Callback & Exchange Code for Tokens ────────────────────
app.get('/auth/success', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  const creds = Buffer.from(
    `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
  ).toString('base64');

  const body = qs.stringify({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: process.env.REDIRECT_URI,
  });

  try {
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

    // Persist the new refresh token in your .env (dev) or DB/vault (prod)
    process.env.REFRESH_TOKEN = refresh_token;

    return res.json({ access_token, refresh_token, expires_in });
  } catch (err) {
    console.error('Token exchange failed:', err.response?.data || err);
    return res.status(500).send('Failed to exchange authorization code');
  }
});
// ──────────────────────────────────────────────────────────────────────────────

// ── 3) Refresh Access Token via Stored Refresh Token ─────────────────────────
app.get('/auth/refresh_token', async (req, res) => {
  if (!process.env.REFRESH_TOKEN) {
    return res.status(400).json({ error: 'No refresh token configured' });
  }

  const creds = Buffer.from(
    `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
  ).toString('base64');

  const body = qs.stringify({
    grant_type: 'refresh_token',
    refresh_token: process.env.REFRESH_TOKEN,
    scope: [
      'https://api.ebay.com/oauth/api_scope',
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
    ].join(' '),
  });

  try {
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

    const { access_token, refresh_token: newRt, expires_in } = data;

    // Overwrite with the newly rotated refresh token
    process.env.REFRESH_TOKEN = newRt;

    return res.json({ access_token, refresh_token: newRt, expires_in });
  } catch (err) {
    console.error('Refresh-token HTTP status:', err.response?.status);
    console.error('Refresh-token error body:', err.response?.data);
    return res.status(500).send('Failed to refresh access token');
  }
});
// ──────────────────────────────────────────────────────────────────────────────

// ✅ Basic Test Route
app.get('/', (req, res) => {
  res.send('Hello World, server is working properly!');
});


// ✅ MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((error) => console.error('MongoDB connection error:', error));

// ── Mount your eBay API routes ────────────────────────────────────────────────
app.use('/api/ebay', ebayRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/pricing-strategies', pricingRoute);
app.use("/api/price-history", priceTrackerRouter);
app.use("/api/competitor-rules", competitorRulesRouter);
// Start the price check interval
setInterval(checkPriceChanges, 10 * 60 * 3000);

// Initial price check at startup
checkPriceChanges();
// ──────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running at http://localhost:${PORT}`);
});
