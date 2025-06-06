import express from "express";
import mongoose, { get } from "mongoose";
import dotenv from "dotenv";
import morgan from "morgan";
import axios from "axios";
import qs from "qs";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import syncRoutes from "./routes/syncRoute.js";
import ebayRoutes from "./routes/ebayRoutes.js";
import cors from "cors";
import authRoutes from "./routes/authRoute.js";
import pricingEngine from "./routes/pricingEngine.js";
import pricingStrategies from "./routes/pricingStrategies.js";
import priceHistoryRoutes from "./routes/priceHistoryRoutes.js";
import competitorRulesRouter from "./routes/competitorRule.js";
import {
  generateEbayAuthCode,
  generateCodeMiddleware,
} from "./controllers/middleware/authenticateUser.js";
import PriceHistory from "./models/history.js";

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB");
  })
  .catch((err) => {
    console.log("❌ Error connecting to MongoDB:", err);
  });

dotenv.config();
const app = express();

app.use(express.json());
app.use(
  cors({
    origin: "*",
    credentials: true,
  })
);

app.use(morgan("short"));

// ── Token Management System ─────────────────────────────────────────────
const tokenManager = {
  // Store tokens in memory
  tokens: {
    accessToken: null,
    refreshToken: null,
    expiryTime: null,
  },

  // Initialize from environment variables if available
  init() {
    this.tokens.accessToken = process.env.AUTH_TOKEN || null;
    this.tokens.refreshToken = process.env.REFRESH_TOKEN || null;
    // this.tokens.expiryTime = process.env.AUTH_TOKEN_EXPIRY ? new Date(process.env.AUTH_TOKEN_EXPIRY) : null;
    console.log(
      "Token manager initialized with:",
      this.tokens.accessToken ? "Access token available" : "No access token",
      this.tokens.refreshToken ? "Refresh token available" : "No refresh token"
    );
  },

  // Update tokens
  updateTokens(accessToken, refreshToken, expiresIn) {
    this.tokens.accessToken = accessToken;
    if (refreshToken) this.tokens.refreshToken = refreshToken;
    this.tokens.expiryTime = new Date(Date.now() + expiresIn * 1000);

    // Also update environment variables for persistence
    process.env.AUTH_TOKEN = accessToken;
    if (refreshToken) process.env.REFRESH_TOKEN = refreshToken;
    process.env.AUTH_TOKEN_EXPIRY = this.tokens.expiryTime.toISOString();

    console.log("Tokens updated, expires at:", this.tokens.expiryTime);
  },

  // Check if token is valid
  isTokenValid() {
    // console.log('Checking token validity...');
    if (!this.tokens.accessToken || !this.tokens.expiryTime) return false;

    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
    return this.tokens.expiryTime > fiveMinutesFromNow;
  },
};

// Initialize token manager
tokenManager.init();

const swaggerOptions = {
  swaggerDefinition: {
    openapi: "3.0.0",
    info: {
      title: "eBay Inventory API",
      version: "1.0.0",
      description: "API for eBay Inventory",
    },
    servers: [
      {
        url: "http://localhost:5000/api/ebay", // Ensure this is pointing to your local server
      },
    ],
  },
  apis: ["./routes/*.js"],
};
const swaggerSpec = swaggerJSDoc(swaggerOptions);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.set("models", { PriceHistory });

app.use("/api/ebay", ebayRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/ebay/pricing-strategies", pricingEngine);
app.use("/api/ebay", priceHistoryRoutes);
app.use("/api/competitor-rules", competitorRulesRouter);

// ── 1. User Auth Flow - Step 1: eBay Login Redirect ─────────────────────────
app.get("/auth/login", (req, res) => {
  const clientId = process.env.CLIENT_ID;
  const redirect = encodeURIComponent(process.env.REDIRECT_URI);

  try {
    const scopes = encodeURIComponent(
      [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
        "https://api.ebay.com/oauth/api_scope/sell.account",
        "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
        "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
      ].join(" ")
    );

    const authUrl =
      `https://auth.ebay.com/oauth2/authorize` +
      `?client_id=${clientId}` +
      `&response_type=code` +
      `&redirect_uri=${redirect}` +
      `&scope=${scopes}`;
    console.log("Redirecting to eBay login:", authUrl);
    res.redirect(authUrl);
  } catch (error) {
    console.error("Login redirect error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate authorization URL",
      error: error.message,
    });
  }
});

// // ── 2. User Auth Flow - Step 2: Handle eBay Callback ─────────────────────────
// app.get('/auth/callback', async (req, res) => {
//   const { code } = req.query;
//   if (!code) {
//     return res.status(400).json({
//       success: false,
//       message: 'Missing authorization code'
//     });
//   }

//   try {
//     const auth = await exchangeCodeForTokens(code);
//     return res.json(auth);
//   } catch (error) {
//     console.error('Auth callback error:', error);
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to exchange authorization code for tokens',
//       error: error.message || error
//     });
//   }
// });

// ── 3. Get Current Auth Token (Primary API) ─────────────────────────────────
app.get("/auth/token", async (req, res) => {
  try {
    console.log("Checking token validity...");
    // If token is valid, return it
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

    // If we have a refresh token, try to refresh
    if (tokenManager.tokens.refreshToken) {
      try {
        const auth = await refreshAccessToken();
        return res.json(auth);
      } catch (error) {
        console.error("Token refresh error:", error);
        // Continue to client credentials if refresh fails
      }
    }

    // Fall back to client credentials flow if user auth not available
    const auth = await getApplicationToken();
    return res.json(auth);
  } catch (error) {
    console.error("Auth token error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get auth token",
      error: error.message || error,
    });
  }
});

// ── 4. Client Credentials Flow (Application Token) ─────────────────────────
app.get("/auth/application_token", async (req, res) => {
  try {
    const auth = await getApplicationToken();
    return res.json(auth);
  } catch (error) {
    console.error("Application token error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get application token",
      error: error.message || error,
    });
  }
});

// ── 5. Token Refresh API ─────────────────────────────────────────────────
app.get("/auth/refresh", async (req, res) => {
  if (!tokenManager.tokens.refreshToken) {
    return res.status(400).json({
      success: false,
      message:
        "No refresh token available. Please complete the authorization flow first.",
      auth_url: "/auth/login",
    });
  }

  try {
    const auth = await refreshAccessToken();
    return res.json(auth);
  } catch (error) {
    console.error("Token refresh error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to refresh token",
      error: error.message || error,
      auth_url: "/auth/login",
    });
  }
});

// ── Helper Functions ─────────────────────────────────────────────────────

// Exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
  const creds = Buffer.from(
    `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
  ).toString("base64");

  const body = qs.stringify({
    grant_type: "authorization_code",
    code: code,
    redirect_uri: process.env.REDIRECT_URI,
  });

  const { data } = await axios.post(
    `https://api.ebay.com/identity/v1/oauth2/token`,
    body,
    {
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const { access_token, refresh_token, expires_in } = data;

  // Update token manager
  tokenManager.updateTokens(access_token, refresh_token, expires_in);

  return {
    success: true,
    auth_token: access_token,
    refresh_token: refresh_token,
    expires_at: tokenManager.tokens.expiryTime,
    expires_in_seconds: expires_in,
    token_type: "user_token",
  };
}

// Refresh access token using stored refresh token
async function refreshAccessToken() {
  const creds = Buffer.from(
    `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
  ).toString("base64");

  const body = qs.stringify({
    grant_type: "refresh_token",
    refresh_token: tokenManager.tokens.refreshToken,
    scope: [
      "https://api.ebay.com/oauth/api_scope",
      "https://api.ebay.com/oauth/api_scope/sell.inventory",
      "https://api.ebay.com/oauth/api_scope/sell.account",
      "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
      "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    ].join(" "),
  });

  const { data } = await axios.post(
    `https://api.ebay.com/identity/v1/oauth2/token`,
    body,
    {
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const { access_token, refresh_token, expires_in } = data;

  // Update token manager
  tokenManager.updateTokens(access_token, refresh_token, expires_in);

  return {
    success: true,
    auth_token: access_token,
    expires_at: tokenManager.tokens.expiryTime,
    expires_in_seconds: expires_in,
    token_type: "user_token",
  };
}

// Get application token (client credentials flow)
async function getApplicationToken() {
  const creds = Buffer.from(
    `${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`
  ).toString("base64");

  const body = qs.stringify({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });

  const { data } = await axios.post(
    `https://api.ebay.com/identity/v1/oauth2/token`,
    body,
    {
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const { access_token, expires_in } = data;

  // Update token manager (application token, no refresh token)
  tokenManager.updateTokens(access_token, null, expires_in);

  return {
    success: true,
    auth_token: access_token,
    expires_at: tokenManager.tokens.expiryTime,
    expires_in_seconds: expires_in,
    token_type: "application_token",
    note: "This token can only be used for APIs that don't require user consent",
  };
}

// ✅ Basic Test Route
app.get("/", (req, res) => {
  res.json({
    message: "eBay Auth Service is running",
    endpoints: {
      user_auth_flow: ["/auth/login", "/auth/callback"],
      get_token: "/auth/token",
      application_token: "/auth/application_token",
      refresh_token: "/auth/refresh",
    },
  });
});

app.get("/auth/generate-code", generateCodeMiddleware);

// Option 2: Add a route that generates a code and exchanges it for tokens
app.get("/auth/automated-login", async (req, res) => {
  try {
    const code = await generateEbayAuthCode();

    // Use your existing function to exchange the code for tokens
    const tokens = await exchangeCodeForTokens(code);

    res.json({
      success: true,
      ...tokens,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to generate tokens",
      error: error.message,
    });
  }
});

// Mount routes with proper prefixes
app.use("/api/competitor-rules", pricingEngine);
app.use("/api/pricing-strategies", pricingStrategies);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Auth Service is running at http://localhost:${PORT}`);
});

// v%5E1.1%23i%5E1%23I%5E3%23r%5E1%23p%5E3%23f%5E0%23t%5EUl41Xzk6REU5NUU1QUUwN0ExNDE2MUZBM0MxNkI5NDFBQzFCMzlfMV8xI0VeMjYw
