import express from "express";
import ebayService from "../services/ebayService.js";
import getEbayListings from "../controllers/ebayController.js";
import { createAllPolicies } from "../services/createPolicy.js";
import { getPolicy, checkAuthToken } from "../services/getPolicy.js";
import fetchProducts from "../services/getInventory.js";
import editRoute from "../services/editProduct.js";
const router = express.Router();

/**
 * @swagger
 * /listings-from-mongo:
 *   get:
 *     description: Retrieve a list of eBay listings
 *     responses:
 *       200:
 *         description: A list of eBay listings
 *       500:
 *         description: Internal server error
 */

router.get("/listings-from-mongo", getEbayListings);

/**
 * @swagger
 * /create-ebay-policies:
 *   post:
 *     description: Create eBay policies
 *     responses:
 *       201:
 *         description: Policies created successfully
 */
router.post("/create-ebay-policies", createAllPolicies);

/**
 * @swagger
 * /get-ebay-policies:
 *   get:
 *     description: Get all eBay policies
 *     responses:
 *       200:
 *         description: List of eBay policies
 */

// Correct way
router.get("/get-fullfilment-policies", async (req, res) => {
  try {
    const policies = await getPolicy("fulfillment");
    res.json(policies);
  } catch (error) {
    console.error("Error in fulfillment policies route:", error);
    res.status(500).json({
      error: "Failed to fetch fulfillment policies",
      details: error.message,
    });
  }
});
// Correct way
router.get("/get-payment-policies", async (req, res) => {
  try {
    const policies = await getPolicy("payment");
    res.json(policies);
  } catch (error) {
    console.error("Error in payment policies route:", error);
    res.status(500).json({
      error: "Failed to fetch payment policies",
      details: error.message,
    });
  }
});
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
            parseFloat(i.shippingOptions?.[0]?.shippingCost?.value || "0") || 0,
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
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/get-return-policies", async (req, res) => {
  try {
    const policies = await getPolicy("return");
    res.json(policies);
  } catch (error) {
    console.error("Error in return policies route:", error);
    res.status(500).json({
      error: "Failed to fetch return policies",
      details: error.message,
    });
  }
});
router.post("/add-merchant-key", ebayService.createMerchantLocation);
router.get("/get-Merchant-key", ebayService.getMerchantKey);
/**
 ** @swagger
 * /active-listings:
 *   get:
 *     description: Get all active selling listings from your eBay inventory
 *     responses:
 *       200:
 *         description: A list of active selling listings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 listings:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Internal server error
 */

router.get("/active-listings", fetchProducts.getActiveListings);
router.get("/active-listingsviaFeed", fetchProducts.getActiveListingsViaFeed);
router.post("/check-token-status", checkAuthToken);
router.get("/item-variations/:itemId", editRoute.getItemVariations);
router.post("/edit-variation-price", editRoute.editVariationPrice);
router.post("/edit-all-variations-price", editRoute.editAllVariationsPrices);
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
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
