// services/ebayService.js

import axios from 'axios';
import xml2js from 'xml2js';
import User from '../models/Users.js';
import { refreshUserAccessToken } from './ebayAuthService.js';
import ebayApi from '../helper/authEbay.js';

/**
 * Fetch all active listings directly from eBay (Trading API).
 * Protected route: expects req.user.id.
 */
export async function fetchEbayListings(userId) {
  const xml = `
    <?xml version="1.0" encoding="utf-8"?>
    <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <RequesterCredentials>
        <eBayAuthToken>TOKEN_PLACEHOLDER</eBayAuthToken>
      </RequesterCredentials>
      <ActiveList>
        <Include>true</Include>
        <Pagination>
          <EntriesPerPage>200</EntriesPerPage>
          <PageNumber>1</PageNumber>
        </Pagination>
      </ActiveList>
      <DetailLevel>ReturnAll</DetailLevel>
    </GetMyeBaySellingRequest>
  `;

  const response = await ebayApi({
    userId,
    method: 'POST',
    url: 'https://api.ebay.com/ws/api.dll',
    data: xml,
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
      'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
      'X-EBAY-API-SITEID': '0',
    },
  });

  const parsed = await new xml2js.Parser({
    explicitArray: false,
    tagNameProcessors: [xml2js.processors.stripPrefix],
  }).parseStringPromise(response);

  const items =
    parsed.GetMyeBaySellingResponse?.ActiveList?.ItemArray?.Item || [];
  return Array.isArray(items) ? items : [items];
}

/**
 * Update price for a single listing (Trading API ReviseInventoryStatus).
 * Protected route: expects req.user.id.
 */
export async function editPrice(userId, { itemId, price, sku }) {
  if (!itemId || price == null) {
    throw new Error('Required fields are missing (itemId and price required)');
  }

  const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>TOKEN_PLACEHOLDER</eBayAuthToken>
  </RequesterCredentials>
  <InventoryStatus>
    <ItemID>${itemId}</ItemID>
    <StartPrice>${price}</StartPrice>
    ${sku ? `<SKU>${sku}</SKU>` : ''}
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;

  const response = await ebayApi({
    userId,
    method: 'POST',
    url: 'https://api.ebay.com/ws/api.dll',
    data: xmlRequest,
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
      'X-EBAY-API-CALL-NAME': 'ReviseInventoryStatus',
      'X-EBAY-API-SITEID': '0',
    },
  });

  const parsed = await new xml2js.Parser({
    explicitArray: false,
    tagNameProcessors: [xml2js.processors.stripPrefix],
  }).parseStringPromise(response);

  const ack = parsed.ReviseInventoryStatusResponse?.Ack;
  if (ack !== 'Success' && ack !== 'Warning') {
    const errors = parsed.ReviseInventoryStatusResponse?.Errors;
    const msg = Array.isArray(errors)
      ? errors.map((e) => e.LongMessage || e.ShortMessage).join(', ')
      : errors?.LongMessage || errors?.ShortMessage || 'Unknown error';
    throw new Error(`eBay API Error: ${msg}`);
  }
  return parsed.ReviseInventoryStatusResponse;
}

export default {
  fetchEbayListings,
  editPrice,
};
