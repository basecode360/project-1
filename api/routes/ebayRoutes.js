import express from "express";
import ebayService from "../services/ebayService.js";
import getEbayListings from "../controllers/ebayController.js";
import fetchProducts from "../services/getInventory.js";
import editRoute from "../services/editProduct.js";
const router = express.Router();



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




router.get("/active-listingsviaFeed", fetchProducts.getActiveListingsViaFeed);
router.get("/item-variations/:itemId", editRoute.getItemVariations);
router.post("/edit-variation-price", editRoute.editVariationPrice);
router.post("/edit-all-variations-price", editRoute.editAllVariationsPrices);


export default router;
