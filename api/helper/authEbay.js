// api/helper/authEbay.js
import axios from 'axios';
import qs from 'qs';
import dotenv from 'dotenv';
dotenv.config();

let cachedToken = null;
let tokenExpiry = 0;
// OAuth credentials
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REFRESH_TOKEN = process.env.REFRESH_TOKEN;

// If you have a long‐lived sandbox token, you can drop it here:
// const STATIC_TOKEN = process.env.EBAY_ACCESS_TOKEN;
// The scopes your app needs
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.item',
  'https://api.ebay.com/oauth/api_scope/sell.item.readonly'
].join(' ');


// 1) Only call the token‐endpoint if no static token is provided
async function getAccessToken() {
  const now = Date.now();

  if (cachedToken && tokenExpiry - now > 60_000) {
    return cachedToken; // return if not about to expire (60s buffer)
  }

  if (!REFRESH_TOKEN || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Missing REFRESH_TOKEN or OAuth credentials in your .env');
  }

  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const body = qs.stringify({
    grant_type: 'refresh_token',
    refresh_token: REFRESH_TOKEN,
    scope: SCOPES,
  });

  const resp = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', body, {
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  cachedToken = resp.data.access_token;
  tokenExpiry = now + resp.data.expires_in * 1000;

  return cachedToken;
}


// Modified part of authEbay.js
export default async function ebayApi({
  method = 'GET',
  url,
  params = {},
  data = null,
}) {
  try {
    const accessToken = await getAccessToken();
    const fullUrl = url.startsWith('http') ? url : `https://api.ebay.com${url}`;
    if (!accessToken) {
      throw new Error('Access token is empty');
    }

    const response = await axios({
      method,
      url: fullUrl,
      params,
      data,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Language': 'en-US',
      },
    });

    return response.data;
  } catch (error) {
    console.error('Error in eBay API request:', error.response ? error.response.data : error.message);
    throw error;
  }
}


export const getActiveListings = async () => {
  // Step 1: Get all inventory items (SKUs)
  const inventoryResponse = await ebayApi({
    method: 'GET',
    url: '/sell/inventory/v1/inventory_item',
  });

  const inventoryItems = inventoryResponse.inventoryItems || [];

  // Step 2: For each SKU, fetch active offers
  let allOffers = [];
  for (const item of inventoryItems) {
    try {
      const offersResponse = await ebayApi({
        method: 'GET',
        url: '/sell/inventory/v1/offer',
        params: { sku: item.sku },
      });

      const offers = offersResponse.offers || [];
      allOffers = allOffers.concat(offers);
    } catch (err) {
      console.error(`Failed to fetch offers for SKU ${item.sku}:`, err.message);
      // Optionally continue with next SKU
    }
  }

  return allOffers;
};




