import express from "express";
import axios from "axios";
import xml2js from "xml2js";

const router = express.Router();

const trackedItems = {};

router.post("/track-item", (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ error: "Missing itemId" });

  if (!trackedItems[itemId]) {
    trackedItems[itemId] = [];
    res.json({ message: `Started tracking item ${itemId}` });
  } else {
    res.json({ message: `Item ${itemId} is already being tracked` });
  }
});

async function fetchItemPrice(itemId) {
  const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
  <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
    <RequesterCredentials>
      <eBayAuthToken>${process.env.AUTH_TOKEN}</eBayAuthToken>
    </RequesterCredentials>
    <ItemID>${itemId}</ItemID>
    <DetailLevel>ReturnAll</DetailLevel>
    <OutputSelector>ItemID</OutputSelector>
    <OutputSelector>Title</OutputSelector>
    <OutputSelector>SellingStatus</OutputSelector>
  </GetItemRequest>`;

  try {
    const response = await axios.post("https://api.ebay.com/ws/api.dll", xmlRequest, {
      headers: {
        "X-EBAY-API-CALL-NAME": "GetItem",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-APP-NAME": process.env.CLIENT_ID,
        "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
        "Content-Type": "text/xml",
      },
    });

    const result = await xml2js.parseStringPromise(response.data, { explicitArray: false });
    const item = result.GetItemResponse.Item;
    if (!item) throw new Error("Item not found in response");

    const currentPrice = parseFloat(item.SellingStatus.CurrentPrice._);
    const timestamp = new Date().toISOString();

    return { currentPrice, timestamp };
  } catch (error) {
    console.error(`Error fetching price for item ${itemId}:`, error.message);
    return null;
  }
}

async function checkPriceChanges() {
  console.log("Checking price changes...");
  for (const itemId of Object.keys(trackedItems)) {
    const priceInfo = await fetchItemPrice(itemId);
    if (!priceInfo) continue;

    const { currentPrice, timestamp } = priceInfo;
    const priceHistory = trackedItems[itemId];
    const lastEntry = priceHistory.length ? priceHistory[priceHistory.length - 1] : null;

    if (!lastEntry || lastEntry.newPrice !== currentPrice) {
      priceHistory.push({
        oldPrice: lastEntry ? lastEntry.newPrice : null,
        newPrice: currentPrice,
        timestamp,
      });
      console.log(`Price changed for ${itemId}: ${lastEntry ? lastEntry.newPrice : "N/A"} -> ${currentPrice}`);
    } else {
      console.log(`No price change for ${itemId} at ${timestamp}`);
    }
  }
}

router.get("/history/:itemId", (req, res) => {
  const { itemId } = req.params;
  const history = trackedItems[itemId];
  if (!history) return res.status(404).json({ error: "Item not tracked" });
  res.json(history);
});

// Export router and checkPriceChanges function for use in main app
export { router as priceTrackerRouter, checkPriceChanges };
