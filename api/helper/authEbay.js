// api/helper/authEbay.js
import axios from 'axios';
import qs from 'qs';
import dotenv from 'dotenv';
dotenv.config();

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
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly'
].join(' ');

// 1) Only call the token‐endpoint if no static token is provided
async function getAccessToken() {
  // if (STATIC_TOKEN) {
  //   return STATIC_TOKEN;
  // }
  
  if (!REFRESH_TOKEN || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Missing REFRESH_TOKEN or OAuth credentials in your .env');
  }

  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
    'base64'
  );

  const body = qs.stringify({
    grant_type: 'refresh_token',
    refresh_token: REFRESH_TOKEN,
    scope: SCOPES,
  });

  const resp = await axios.post(
    'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
    body,
    {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  // eBay sometimes rotates the refresh token
  // You can inspect resp.data.refresh_token and persist it if you want
  return resp.data.access_token;
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
    
    // Make the axios request
    const config = {
      headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US' // Add this line
    },
  }
    const response = await axios({
      method,
      url,
      params,
      data,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json', // Changed from 'application/xml'
        'Content-Language': 'en-US',
      },
    });

    return response.data;
  } catch (error) {
    console.error('Error in eBay API request:', error.response ? error.response.data : error.message);

    if (error.response) {
      console.error('Response error status:', error.response.status);
      console.error('Response data:', error.response.data);
    }

    throw error; // Throw the actual error for better debugging
  }
}


