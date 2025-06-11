// services/ebayAuthService.js
import axios from 'axios';
import qs from 'qs';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const SCOPES =
  process.env.EBAY_OAUTH_SCOPES || 'https://api.ebay.com/oauth/api_scope';

// if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
//   throw new Error(
//     'Missing eBay OAuth environment variables (CLIENT_ID, CLIENT_SECRET, EBAY_REDIRECT_URI)'
//   );
// }

import User from '../models/Users.js'; // <— import the User model now

/**
 * Build the URL you redirect your frontend user to, for them to consent on eBay.
 */
export function getEbayAuthUrl(stateJwt) {
  const base = 'https://auth.ebay.com/oauth2/authorize';
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    state: stateJwt,
  });
  return `${base}?${params.toString()}`;
}

/**
 * Exchange the authorization code that eBay gives us
 * for an access token + refresh token.
 * Returns { access_token, refresh_token, expires_in }.
 */
export async function exchangeCodeForToken(code, userId) {
  console.log('[exchangeCodeForToken] Exchanging code for user:', userId);
  console.log('[exchangeCodeForToken] Code received:', code);

  try {
    const tokenUrl = 'https://api.ebay.com/identity/v1/oauth2/token';
    const basicAuth = Buffer.from(
      `ChrisVon-MyApp-PRD-d6c9c827e-1bb2dbb6:PRD-6c9c827eb098-0503-4dbc-9c10-4838`
    ).toString('base64');

    const data = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://partstunt.netlify.app/auth/popup-callback',
    };

    const response = await axios.post(tokenUrl, qs.stringify(data), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
    });

    console.log(
      '[exchangeCodeForToken] Token exchange response from eBay:',
      response.data
    );

    // 1) Save tokens on the User model:
    const tokens = response.data; // { access_token, refresh_token, expires_in, … }
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    console.log(
      '[exchangeCodeForToken] Storing tokens in DB for user:',
      userId
    );

    await User.findByIdAndUpdate(userId, {
      $set: {
        'ebay.accessToken': tokens.access_token,
        'ebay.refreshToken': tokens.refresh_token,
        'ebay.expiresAt': expiresAt,
      },
    });

    return tokens;
  } catch (err) {
    console.error(
      '[exchangeCodeForToken] ERROR exchanging code:',
      err?.response?.data || err
    );
    throw err;
  }
}

/**
 * Use a stored refresh token to get a new access token
 */
export async function refreshUserAccessToken(userId) {
  // 1) Load the user’s refreshToken from User.ebay
  const user = await User.findById(userId).select(
    'ebay.refreshToken ebay.expiresAt'
  );
  if (!user || !user.ebay.refreshToken) {
    throw new Error('No refresh token available for user');
  }
  const oldRefreshToken = user.ebay.refreshToken;

  // 2) Make the refresh request
  const tokenUrl = 'https://api.ebay.com/identity/v1/oauth2/token';
  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
    'base64'
  );
  const data = {
    grant_type: 'refresh_token',
    refresh_token: oldRefreshToken,
    scope: SCOPES,
  };

  const response = await axios.post(tokenUrl, qs.stringify(data), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
  });

  const tokens = response.data; // { access_token, refresh_token?, expires_in, … }
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  // 3) Save them back onto user.ebay
  const updateFields = {
    'ebay.accessToken': tokens.access_token,
    'ebay.expiresAt': expiresAt,
  };
  if (tokens.refresh_token) {
    updateFields['ebay.refreshToken'] = tokens.refresh_token;
  }
  await User.findByIdAndUpdate(userId, { $set: updateFields });

  return tokens;
}
