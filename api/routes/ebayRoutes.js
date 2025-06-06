import express from "express";
import xml2js from "xml2js";
import axios from "axios";

const router = express.Router();

/**
 * Helper Functions (same as before, reused for eBay XML calls)
 */

async function parseXMLResponse(xmlData) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    tagNameProcessors: [xml2js.processors.stripPrefix],
  });
  return await parser.parseStringPromise(xmlData);
}

function isEBayResponseSuccessful(result, operationName) {
  const response = result[operationName + "Response"];
  if (response.Ack !== "Success" && response.Ack !== "Warning") {
    const errors = response.Errors;
    const errorMsg = Array.isArray(errors)
      ? errors.map((e) => e.LongMessage || e.ShortMessage).join(", ")
      : errors?.LongMessage || errors?.ShortMessage || "Unknown error";
    throw new Error(`eBay API Error: ${errorMsg}`);
  }
  return response;
}

async function makeEBayAPICall(xmlRequest, callName) {
  const response = await axios({
    method: "post",
    url: "https://api.ebay.com/ws/api.dll",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1155",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": "0",
    },
    data: xmlRequest,
  });
  return response.data;
}

/**
 * 1️⃣ GET /api/ebay/competitor-prices/:itemId
 *     Fetch “GetItem” from Trading API + Browse API competitor prices
 */
router.get("/competitor-prices/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const oauthToken = process.env.AUTH_TOKEN; // Trading API
    const appId = process.env.CLIENT_ID; // Browse API

    if (!oauthToken) {
      return res
        .status(400)
        .json({ success: false, message: "eBay auth token is required" });
    }

    // 1) GetItem request (Trading API)
    const getItemXml = `
      <?xml version="1.0" encoding="utf-8"?>
      <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${oauthToken}</eBayAuthToken>
        </RequesterCredentials>
        <ItemID>${itemId}</ItemID>
        <DetailLevel>ReturnAll</DetailLevel>
        <IncludeItemSpecifics>true</IncludeItemSpecifics>
      </GetItemRequest>
    `;
    const getItemResponse = await makeEBayAPICall(getItemXml, "GetItem");
    const parsedItem = await parseXMLResponse(getItemResponse);
    const itemResult = isEBayResponseSuccessful(parsedItem, "GetItem");
    const item = itemResult.Item;
    if (!item) {
      throw new Error(`Item ${itemId} not found`);
    }

    // Extract title & category for Browse call
    const title = item.Title || "";
    const categoryId = item.PrimaryCategory?.CategoryID || "";

    // 2) Browse API competitor prices
    const query = new URLSearchParams({
      q: title,
      category_ids: categoryId,
      limit: 20,
      sort: "price",
    });
    const browseResponse = await axios.get(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${query.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${appId}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const items = browseResponse.data.itemSummaries || [];
    const competitorPrices = items
      .filter((i) => i.itemId !== itemId)
      .map((i) => {
        const price = parseFloat(i.price.value);
        const shipping = parseFloat(
          i.shippingOptions?.[0]?.shippingCost?.value || "0"
        );
        return +(price + shipping).toFixed(2);
      })
      .filter((p) => !isNaN(p) && p > 0);

    res.json({
      success: true,
      itemId,
      itemTitle: item.Title,
      competitorPrices: {
        allData: items.map((i) => ({
          id: i.itemId,
          title: i.title,
          price: parseFloat(i.price.value),
          shipping:
            parseFloat(i.shippingOptions?.[0]?.shippingCost?.value || "0") ||
            0,
          imageurl: i.thumbnailImages[0]?.imageUrl || "",
          seller: i.seller?.username,
          condition: i.condition,
          productUrl: i.itemWebUrl,
          locale: i.itemLocation?.country,
        })),
        lowestPrice:
          competitorPrices.length > 0 ? Math.min(...competitorPrices) : 0,
        allPrices: competitorPrices,
      },
    });
  } catch (error) {
    console.error("Error fetching competitor prices:", error);
    if (error.message.includes("rate limit")) {
      return res.status(429).json({
        success: false,
        message: "eBay API rate limit exceeded. Try again later.",
        error: error.message,
      });
    }
    return res
      .status(500)
      .json({ success: false, message: error.message });
  }
});

/**
 * 2️⃣ Debug endpoint to inspect raw ItemSpecifics
 *    GET /api/ebay/debug/item-specifics/:itemId
 */
router.get("/debug/item-specifics/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const authToken = process.env.AUTH_TOKEN;
    if (!authToken) {
      return res
        .status(400)
        .json({ success: false, message: "eBay auth token is required" });
    }

    const getItemXml = `
      <?xml version="1.0" encoding="utf-8"?>
      <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <ItemID>${itemId}</ItemID>
        <DetailLevel>ReturnAll</DetailLevel>
        <IncludeItemSpecifics>true</IncludeItemSpecifics>
      </GetItemRequest>
    `;
    const xmlResponse = await makeEBayAPICall(getItemXml, "GetItem");
    const parsed = await parseXMLResponse(xmlResponse);
    const ebayRes = isEBayResponseSuccessful(parsed, "GetItem");
    const item = ebayRes.Item;
    if (!item) {
      throw new Error(`Item ${itemId} not found`);
    }

    const specs = item.ItemSpecifics?.NameValueList || [];
    const arr = Array.isArray(specs) ? specs : [specs];
    res.json({
      success: true,
      itemId,
      itemTitle: item.Title,
      totalSpecifics: arr.length,
      allItemSpecifics: arr.map((s) => ({ name: s.Name, value: s.Value })),
    });
  } catch (error) {
    console.error("Debug ItemSpecifics Error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: error.message });
  }
});

export default router;
