import express from "express";
import xml2js from "xml2js";
import axios from "axios";
import {
  createCompetitorRule,
  applyRuleToItems,
  getAllCompetitorRules,
} from "../controllers/competitorRule.js";
const router = express.Router();

/**
 * ===============================
 * COMPETITOR RULES API
 * ===============================
 *
 * This file contains all competitor rule management APIs:
 * - Create competitor rule on specific product
 * - Create competitor rule and assign to all active listings
 * - Fetch competitor rules from specific product
 * - Fetch all active listings with competitor rules
 * - Update competitor rule on specific product
 * - Delete competitor rule from specific product
 * - Delete competitor rules from all active listings
 */

/**
 * Helper Functions
 */

// Parse XML response helper
async function parseXMLResponse(xmlData) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    tagNameProcessors: [xml2js.processors.stripPrefix],
  });
  return await parser.parseStringPromise(xmlData);
}

// Check if eBay API response is successful
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

// Make eBay XML API call
async function makeEBayAPICall(xmlRequest, callName) {
  const response = await axios({
    method: "post",
    url: "https://api.ebay.com/ws/api.dll",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1155",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": "0", // US site
    },
    data: xmlRequest,
  });
  return response.data;
}

// Create competitor rule XML specifics
function createCompetitorRuleSpecifics(ruleData) {
  const {
    ruleName,
    minPercentOfCurrentPrice,
    maxPercentOfCurrentPrice,
    excludeCountries = [],
    excludeConditions = [],
    excludeProductTitleWords = [],
    excludeSellers = [],
    findCompetitorsBasedOnMPN = false,
  } = ruleData;

  const ruleSpecifics = [
    { name: "CompetitorRuleName", value: ruleName },
    {
      name: "FindCompetitorsBasedOnMPN",
      value: findCompetitorsBasedOnMPN.toString(),
    },
  ];

  if (minPercentOfCurrentPrice !== undefined) {
    ruleSpecifics.push({
      name: "MinPercentOfCurrentPrice",
      value: minPercentOfCurrentPrice.toString(),
    });
  }

  if (maxPercentOfCurrentPrice !== undefined) {
    ruleSpecifics.push({
      name: "MaxPercentOfCurrentPrice",
      value: maxPercentOfCurrentPrice.toString(),
    });
  }

  // Handle arrays by joining with semicolons
  if (excludeCountries.length > 0) {
    ruleSpecifics.push({
      name: "ExcludeCountries",
      value: excludeCountries.join(";"),
    });
  }

  if (excludeConditions.length > 0) {
    ruleSpecifics.push({
      name: "ExcludeConditions",
      value: excludeConditions.join(";"),
    });
  }

  if (excludeProductTitleWords.length > 0) {
    ruleSpecifics.push({
      name: "ExcludeProductTitleWords",
      value: excludeProductTitleWords.join(";"),
    });
  }

  if (excludeSellers.length > 0) {
    ruleSpecifics.push({
      name: "ExcludeSellers",
      value: excludeSellers.join(";"),
    });
  }

  // Add timestamp
  ruleSpecifics.push({
    name: "CompetitorRuleCreatedAt",
    value: new Date().toISOString(),
  });

  return ruleSpecifics;
}

/**
 * ===============================
 * 1. CREATE COMPETITOR RULE ON SPECIFIC PRODUCT
 * ===============================
 */

router.post("/products/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const {
      ruleName,
      minPercentOfCurrentPrice,
      maxPercentOfCurrentPrice,
      excludeCountries = [],
      excludeConditions = [],
      excludeProductTitleWords = [],
      excludeSellers = [],
      findCompetitorsBasedOnMPN = false,
    } = req.body;

    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required",
      });
    }

    if (!ruleName) {
      return res.status(400).json({
        success: false,
        message: "Rule name is required",
      });
    }

    // Validate percentages
    if (
      minPercentOfCurrentPrice !== undefined &&
      (typeof minPercentOfCurrentPrice !== "number" ||
        minPercentOfCurrentPrice < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Minimum percent must be a non-negative number",
      });
    }

    if (
      maxPercentOfCurrentPrice !== undefined &&
      (typeof maxPercentOfCurrentPrice !== "number" ||
        maxPercentOfCurrentPrice < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Maximum percent must be a non-negative number",
      });
    }

    if (
      minPercentOfCurrentPrice !== undefined &&
      maxPercentOfCurrentPrice !== undefined &&
      minPercentOfCurrentPrice >= maxPercentOfCurrentPrice
    ) {
      return res.status(400).json({
        success: false,
        message: "Minimum percent must be less than maximum percent",
      });
    }

    // Create competitor rule specifics
    const ruleSpecifics = createCompetitorRuleSpecifics(req.body);

    const xmlRequest = `
      <?xml version="1.0" encoding="utf-8"?>
      <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <Item>
          <ItemID>${itemId}</ItemID>
          <ItemSpecifics>
            ${ruleSpecifics
              .map(
                (spec) => `
            <NameValueList>
              <n>${spec.name}</n>
              <Value>${spec.value}</Value>
            </NameValueList>
            `
              )
              .join("")}
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "ReviseItem");
    await createCompetitorRule(req, res);
    res.json({
      success: true,
      message: "Competitor rule created successfully on eBay product",
      itemId,
      rule: {
        name: ruleName,
        minPercentOfCurrentPrice,
        maxPercentOfCurrentPrice,
        excludeCountries,
        excludeConditions,
        excludeProductTitleWords,
        excludeSellers,
        findCompetitorsBasedOnMPN,
      },
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime,
      },
    });
  } catch (error) {
    console.error("eBay Competitor Rule Creation Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * ===============================
 * 2. CREATE COMPETITOR RULE AND ASSIGN TO ALL ACTIVE LISTINGS
 * ===============================
 */

// Apply competitor rule while preserving pricing strategy
router.post("/apply-competitor-rule/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const ruleOptions = req.body;
    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res
        .status(400)
        .json({ success: false, message: "eBay auth token is required" });
    }

    // First, retrieve existing item specifics
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

    const getItemResponse = await makeEBayAPICall(getItemXml, "GetItem");
    const getItemResult = await parseXMLResponse(getItemResponse);
    const item = isEBayResponseSuccessful(getItemResult, "GetItem");

    // Extract existing item specifics
    const existingSpecifics = item.Item.ItemSpecifics?.NameValueList || [];

    // Filter out competitor rule related specifics if they exist
    const nonCompetitorRuleSpecifics = existingSpecifics.filter(
      (spec) => !isCompetitorRuleSpecific(spec.Name)
    );

    // Create new competitor rule specifics
    const competitorRuleSpecifics = createCompetitorRuleSpecifics(ruleOptions);

    // Build XML for the update with both sets of specifics
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
      <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <Item>
          <ItemID>${itemId}</ItemID>
          <ItemSpecifics>
            <!-- Include existing non-competitor rule specifics -->
            ${nonCompetitorRuleSpecifics
              .map(
                (spec) => `
              <NameValueList>
                <Name>${spec.Name}</Name>
                <Value>${spec.Value}</Value>
              </NameValueList>
            `
              )
              .join("")}
            
            <!-- Add new competitor rule specifics -->
            ${competitorRuleSpecifics
              .map(
                (spec) => `
              <NameValueList>
                <Name>${spec.name}</Name>
                <Value>${spec.value}</Value>
              </NameValueList>
            `
              )
              .join("")}
            
            <!-- Ensure Brand and Type are present -->
            ${
              !nonCompetitorRuleSpecifics.some((spec) => spec.Name === "Brand")
                ? `
              <NameValueList>
                <Name>Brand</Name>
                <Value>YourBrandName</Value>
              </NameValueList>
            `
                : ""
            }
            
            ${
              !nonCompetitorRuleSpecifics.some((spec) => spec.Name === "Type")
                ? `
              <NameValueList>
                <Name>Type</Name>
                <Value>YourTypeName</Value>
              </NameValueList>
            `
                : ""
            }
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "ReviseItem");
    createCompetitorRule(req, res);
    applyRuleToItems(req, res);
    return res.json({
      success: true,
      message:
        "Competitor rule applied successfully while preserving pricing strategy",
      itemId,
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime,
      },
    });
  } catch (error) {
    console.error("Apply Competitor Rule Error:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Helper function to identify competitor rule specifics
function isCompetitorRuleSpecific(name) {
  const competitorRuleSpecificNames = [
    "RuleName",
    "MinPercentOfCurrentPrice",
    "MaxPercentOfCurrentPrice",
    "ExcludeCountry",
    "ExcludeCondition",
    "ExcludeProductTitleWord",
    "ExcludeSeller",
    "FindCompetitorsBasedOnMPN",
  ];

  return competitorRuleSpecificNames.includes(name);
}

// Similar helper for pricing strategy specifics
function isPricingStrategySpecific(name) {
  const pricingStrategySpecificNames = [
    "PricingStrategyName",
    "RepricingRule",
    "NoCompetitionAction",
    "BeatBy",
    "BeatValue",
    "StayAboveBy",
    "StayAboveValue",
    "MaxPrice",
    "MinPrice",
    "IsPricingStrategy",
  ];

  return pricingStrategySpecificNames.includes(name);
}

router.post("/assign-to-all-active", async (req, res) => {
  try {
    const {
      ruleName,
      minPercentOfCurrentPrice,
      maxPercentOfCurrentPrice,
      excludeCountries = [],
      excludeConditions = [],
      excludeProductTitleWords = [],
      excludeSellers = [],
      findCompetitorsBasedOnMPN = false,
    } = req.body;

    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required",
      });
    }

    if (!ruleName) {
      return res.status(400).json({
        success: false,
        message: "Rule name is required",
      });
    }

    // Step 1: Get all active listings
    const getActiveListingsXML = `
      <?xml version="1.0" encoding="utf-8"?>
      <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
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

    console.log("Fetching active listings for competitor rule assignment...");
    const activeListingsResponse = await makeEBayAPICall(
      getActiveListingsXML,
      "GetMyeBaySelling"
    );
    const activeListingsResult = await parseXMLResponse(activeListingsResponse);
    const activeListingsData = isEBayResponseSuccessful(
      activeListingsResult,
      "GetMyeBaySelling"
    );

    const activeList = activeListingsData.ActiveList;
    if (!activeList || !activeList.ItemArray) {
      return res.json({
        success: true,
        message: "No active listings found",
        assignedCount: 0,
        listings: [],
      });
    }

    const items = Array.isArray(activeList.ItemArray.Item)
      ? activeList.ItemArray.Item
      : [activeList.ItemArray.Item];

    console.log(
      `Found ${items.length} active listings for competitor rule assignment`
    );

    // Step 2: Create competitor rule specifics
    const ruleSpecifics = createCompetitorRuleSpecifics(req.body);
    ruleSpecifics.push({ name: "AssignedToAllActiveListings", value: "true" });

    // Step 3: Apply competitor rule to each active listing
    const results = [];
    const errors = [];

    for (const item of items) {
      try {
        const itemId = item.ItemID;

        console.log(`Applying competitor rule to item ${itemId}...`);

        const xmlRequest = `
          <?xml version="1.0" encoding="utf-8"?>
          <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
            <RequesterCredentials>
              <eBayAuthToken>${authToken}</eBayAuthToken>
            </RequesterCredentials>
            <Item>
              <ItemID>${itemId}</ItemID>
              <ItemSpecifics>
                ${ruleSpecifics
                  .map(
                    (spec) => `
                <NameValueList>
                  <n>${spec.name}</n>
                  <Value>${spec.value}</Value>
                </NameValueList>
                `
                  )
                  .join("")}
              </ItemSpecifics>
            </Item>
          </ReviseItemRequest>
        `;

        const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
        const result = await parseXMLResponse(xmlResponse);
        isEBayResponseSuccessful(result, "ReviseItem");

        results.push({
          itemId,
          title: item.Title,
          success: true,
          message: "Competitor rule applied successfully",
        });

        // Add small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(
          `Error applying competitor rule to item ${item.ItemID}:`,
          error.message
        );
        errors.push({
          itemId: item.ItemID,
          title: item.Title,
          success: false,
          error: error.message,
        });
      }
    }

    const successCount = results.length;
    const errorCount = errors.length;

    res.json({
      success: true,
      message: `Competitor rule assigned to ${successCount} of ${items.length} active listings`,
      competitorRule: {
        name: ruleName,
        minPercentOfCurrentPrice,
        maxPercentOfCurrentPrice,
        excludeCountries,
        excludeConditions,
        excludeProductTitleWords,
        excludeSellers,
        findCompetitorsBasedOnMPN,
      },
      summary: {
        totalActiveListings: items.length,
        successfulAssignments: successCount,
        failedAssignments: errorCount,
      },
      successfulAssignments: results,
      failedAssignments: errors,
    });
  } catch (error) {
    console.error("eBay Bulk Competitor Rule Assignment Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * ===============================
 * 4. FETCH ALL ACTIVE LISTINGS WITH COMPETITOR RULES
 * ===============================
 */

router.get("/active-listings", async (req, res) => {
  try {
    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required",
      });
    }

    // Get all active listings
    const getActiveListingsXML = `
      <?xml version="1.0" encoding="utf-8"?>
      <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
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

    const activeListingsResponse = await makeEBayAPICall(
      getActiveListingsXML,
      "GetMyeBaySelling"
    );
    const activeListingsResult = await parseXMLResponse(activeListingsResponse);
    const activeListingsData = isEBayResponseSuccessful(
      activeListingsResult,
      "GetMyeBaySelling"
    );

    const activeList = activeListingsData.ActiveList;
    if (!activeList || !activeList.ItemArray) {
      return res.json({
        success: true,
        message: "No active listings found",
        listings: [],
      });
    }

    const items = Array.isArray(activeList.ItemArray.Item)
      ? activeList.ItemArray.Item
      : [activeList.ItemArray.Item];

    // For each item, extract basic info and check if it has competitor rules
    const listingsWithCompetitorRules = items.map((item) => {
      const itemSpecifics = item.ItemSpecifics?.NameValueList || [];
      const competitorRule = parseCompetitorRuleFromSpecifics(
        itemSpecifics,
        item.ItemID
      );

      return {
        itemId: item.ItemID,
        title: item.Title,
        currentPrice: item.StartPrice?.Value || item.StartPrice?.__value__ || 0,
        currency: item.StartPrice?.__attributes__?.currencyID || "USD",
        listingType: item.ListingType,
        hasCompetitorRule: competitorRule !== null,
        competitorRule,
      };
    });

    const withCompetitorRule = listingsWithCompetitorRules.filter(
      (item) => item.hasCompetitorRule
    );
    const withoutCompetitorRule = listingsWithCompetitorRules.filter(
      (item) => !item.hasCompetitorRule
    );

    res.json({
      success: true,
      summary: {
        totalActiveListings: listingsWithCompetitorRules.length,
        listingsWithCompetitorRule: withCompetitorRule.length,
        listingsWithoutCompetitorRule: withoutCompetitorRule.length,
      },
      listings: listingsWithCompetitorRules,
    });
  } catch (error) {
    console.error(
      "eBay Active Listings with Competitor Rules Fetch Error:",
      error.message
    );
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * ===============================
 * 5. UPDATE COMPETITOR RULE ON SPECIFIC PRODUCT
 * ===============================
 */

router.put("/products/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const {
      ruleName,
      minPercentOfCurrentPrice,
      maxPercentOfCurrentPrice,
      excludeCountries = [],
      excludeConditions = [],
      excludeProductTitleWords = [],
      excludeSellers = [],
      findCompetitorsBasedOnMPN = false,
    } = req.body;

    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required",
      });
    }

    if (!ruleName) {
      return res.status(400).json({
        success: false,
        message: "Rule name is required",
      });
    }

    // Create updated competitor rule specifics
    const ruleSpecifics = createCompetitorRuleSpecifics(req.body);
    ruleSpecifics.push({
      name: "CompetitorRuleUpdatedAt",
      value: new Date().toISOString(),
    });

    const xmlRequest = `
      <?xml version="1.0" encoding="utf-8"?>
      <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <Item>
          <ItemID>${itemId}</ItemID>
          <ItemSpecifics>
            ${ruleSpecifics
              .map(
                (spec) => `
            <NameValueList>
              <n>${spec.name}</n>
              <Value>${spec.value}</Value>
            </NameValueList>
            `
              )
              .join("")}
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "ReviseItem");

    res.json({
      success: true,
      message: "Competitor rule updated successfully on eBay product",
      itemId,
      rule: {
        name: ruleName,
        minPercentOfCurrentPrice,
        maxPercentOfCurrentPrice,
        excludeCountries,
        excludeConditions,
        excludeProductTitleWords,
        excludeSellers,
        findCompetitorsBasedOnMPN,
      },
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime,
      },
    });
  } catch (error) {
    console.error("eBay Competitor Rule Update Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * ===============================
 * 6. DELETE COMPETITOR RULE FROM SPECIFIC PRODUCT
 * ===============================
 */

router.delete("/products/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required",
      });
    }

    // Add deletion markers to ItemSpecifics
    const xmlRequest = `
      <?xml version="1.0" encoding="utf-8"?>
      <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <Item>
          <ItemID>${itemId}</ItemID>
          <ItemSpecifics>
            <NameValueList>
              <n>CompetitorRuleDeleted</n>
              <Value>true</Value>
            </NameValueList>
            <NameValueList>
              <n>CompetitorRuleDeletedAt</n>
              <Value>${new Date().toISOString()}</Value>
            </NameValueList>
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "ReviseItem");

    res.json({
      success: true,
      message: "Competitor rule deleted successfully from eBay product",
      itemId,
      deletedAt: new Date().toISOString(),
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime,
      },
    });
  } catch (error) {
    console.error("eBay Competitor Rule Deletion Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * ===============================
 * 7. DELETE COMPETITOR RULES FROM ALL ACTIVE LISTINGS
 * ===============================
 */

router.delete("/delete-from-all-active", async (req, res) => {
  try {
    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required",
      });
    }

    // First get all active listings with competitor rules
    const listingsResponse = await axios.get("/active-listings", {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    const listingsWithCompetitorRules = listingsResponse.data.listings.filter(
      (item) => item.hasCompetitorRule
    );

    if (listingsWithCompetitorRules.length === 0) {
      return res.json({
        success: true,
        message: "No active listings with competitor rules found",
        deletedCount: 0,
      });
    }

    const results = [];
    const errors = [];

    // Delete competitor rule from each listing
    for (const listing of listingsWithCompetitorRules) {
      try {
        const xmlRequest = `
          <?xml version="1.0" encoding="utf-8"?>
          <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
            <RequesterCredentials>
              <eBayAuthToken>${authToken}</eBayAuthToken>
            </RequesterCredentials>
            <Item>
              <ItemID>${listing.itemId}</ItemID>
              <ItemSpecifics>
                <NameValueList>
                  <n>CompetitorRuleDeleted</n>
                  <Value>true</Value>
                </NameValueList>
                <NameValueList>
                  <n>CompetitorRuleDeletedAt</n>
                  <Value>${new Date().toISOString()}</Value>
                </NameValueList>
              </ItemSpecifics>
            </Item>
          </ReviseItemRequest>
        `;

        const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
        const result = await parseXMLResponse(xmlResponse);
        isEBayResponseSuccessful(result, "ReviseItem");

        results.push({
          itemId: listing.itemId,
          title: listing.title,
          success: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        errors.push({
          itemId: listing.itemId,
          title: listing.title,
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      message: `Competitor rule deletion processed for ${results.length} listings`,
      summary: {
        totalProcessed: listingsWithCompetitorRules.length,
        successful: results.length,
        failed: errors.length,
      },
      results,
      errors,
    });
  } catch (error) {
    console.error("eBay Competitor Rule Bulk Deletion Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Debug competitor rule data - add this endpoint to see what's actually stored

router.get("/debug/competitor-rule-specifics/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required",
      });
    }

    const xmlRequest = `
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

    const xmlResponse = await makeEBayAPICall(xmlRequest, "GetItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "GetItem");

    const item = response.Item;
    if (!item) {
      throw new Error(`Item ${itemId} not found`);
    }

    const itemSpecifics = item.ItemSpecifics?.NameValueList || [];
    const specificsArray = Array.isArray(itemSpecifics)
      ? itemSpecifics
      : [itemSpecifics];

    // Filter for competitor rule related specifics
    const competitorRuleSpecifics = specificsArray.filter((spec) => {
      if (!spec?.Name) return false;
      const name = spec.Name.toLowerCase();
      return (
        name.includes("competitor") ||
        name.includes("rule") ||
        name.includes("exclude") ||
        name.includes("percent") ||
        name.includes("mpn") ||
        name.includes("upc") ||
        name.includes("ean") ||
        name.includes("isbn") ||
        name === "FindCompetitorsBasedOnMPN"
      );
    });

    res.json({
      success: true,
      itemId,
      itemTitle: item.Title,
      totalSpecifics: specificsArray.length,
      competitorRuleRelatedSpecifics: competitorRuleSpecifics.map((spec) => ({
        name: spec.Name,
        value: spec.Value,
      })),
      allItemSpecifics: specificsArray.map((spec) => ({
        name: spec.Name,
        value: spec.Value,
      })),
    });
  } catch (error) {
    console.error("Debug Competitor Rule Specifics Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Fixed parseCompetitorRuleFromSpecifics function that correctly identifies rule data
function parseCompetitorRuleFromSpecifics(itemSpecifics, itemId) {
  const specificsArray = Array.isArray(itemSpecifics)
    ? itemSpecifics
    : [itemSpecifics];
  const ruleData = {};

  console.log(`=== DEBUG: Parsing competitor rule for item ${itemId} ===`);

  // STRICT filtering: Only accept fields that are EXCLUSIVELY competitor rule fields
  const COMPETITOR_RULE_FIELDS = [
    // Exact field names for competitor rules (not shared with pricing strategy)
    "CompetitorRuleName",
    "MinPercentOfCurrentPrice", // Different from MinPrice (pricing strategy)
    "MaxPercentOfCurrentPrice", // Different from MaxPrice (pricing strategy)
    "ExcludeCountries",
    "ExcludeConditions",
    "ExcludeProductTitleWords",
    "ExcludeSellers",
    "FindCompetitorsBasedOnMPN",
    "CompetitorRuleCreatedAt",

    // Alternative naming conventions
    "competitor_rule_name",
    "min_percent_of_current_price",
    "max_percent_of_current_price",
    "exclude_countries",
    "exclude_conditions",
    "exclude_product_title_words",
    "exclude_sellers",
    "find_competitors_based_on_mpn",
    "competitor_rule_created_at",
  ];

  // Extract only TRUE competitor rule-related data
  specificsArray.forEach((specific) => {
    if (specific?.Name && specific?.Value) {
      const name = specific.Name;
      const value = specific.Value;

      // STRICT check: only accept fields in the whitelist
      if (COMPETITOR_RULE_FIELDS.includes(name)) {
        ruleData[name] = value;
        console.log(`Found competitor rule field: ${name} = ${value}`);
      } else {
        // Log what we're rejecting for debugging
        console.log(
          `Rejecting field (not a competitor rule field): ${name} = ${value}`
        );
      }
    }
  });

  console.log(`Found competitor rule data for item ${itemId}:`, ruleData);

  // If no actual competitor rule data found, return null
  if (Object.keys(ruleData).length === 0) {
    console.log(`No competitor rule data found for item ${itemId}`);
    return null;
  }

  // Map the fields to the expected format
  const rule = {
    itemId,
    ruleName:
      ruleData.CompetitorRuleName ||
      ruleData.competitor_rule_name ||
      "Unnamed Rule",

    minPercentOfCurrentPrice: parsePercentage(
      ruleData.MinPercentOfCurrentPrice || ruleData.min_percent_of_current_price
    ),

    maxPercentOfCurrentPrice: parsePercentage(
      ruleData.MaxPercentOfCurrentPrice || ruleData.max_percent_of_current_price
    ),

    findCompetitorsBasedOnMPN: parseBoolean(
      ruleData.FindCompetitorsBasedOnMPN ||
        ruleData.find_competitors_based_on_mpn
    ),

    excludeCountries: parseArray(
      ruleData.ExcludeCountries || ruleData.exclude_countries
    ),

    excludeConditions: parseArray(
      ruleData.ExcludeConditions || ruleData.exclude_conditions
    ),

    excludeProductTitleWords: parseArray(
      ruleData.ExcludeProductTitleWords || ruleData.exclude_product_title_words
    ),

    excludeSellers: parseArray(
      ruleData.ExcludeSellers || ruleData.exclude_sellers
    ),

    createdAt:
      ruleData.CompetitorRuleCreatedAt ||
      ruleData.competitor_rule_created_at ||
      null,
  };

  console.log(`Parsed competitor rule for item ${itemId}:`, rule);
  return rule;
}

// Test the fixed parser with the current data
router.get("/test-competitor-rule-parsing/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;

    // Simulate the actual data from your product
    const actualItemSpecifics = [
      { Name: "MPN", Value: "Does Not Apply" },
      { Name: "CompetitorAdjustment", Value: "-5" }, // This is pricing strategy, not competitor rule
    ];

    const parsedRule = parseCompetitorRuleFromSpecifics(
      actualItemSpecifics,
      itemId
    );

    res.json({
      success: true,
      message: "Testing parser with actual product data",
      itemId,
      actualItemSpecifics,
      parsedResult: parsedRule,
      hasCompetitorRule: parsedRule !== null,
      explanation:
        parsedRule === null
          ? "No competitor rule data found - MPN and CompetitorAdjustment are not competitor rule fields"
          : "Competitor rule data found and parsed successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});
// Helper functions for parsing different data types
function parsePercentage(value) {
  if (!value) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

function parseBoolean(value) {
  if (!value) return false;
  if (typeof value === "boolean") return value;
  const str = value.toString().toLowerCase();
  return str === "true" || str === "1" || str === "yes";
}

function parseArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  // Try to split by semicolon first, then comma
  if (typeof value === "string") {
    if (value.includes(";")) {
      return value
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s);
    } else if (value.includes(",")) {
      return value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s);
    } else {
      return [value.trim()].filter((s) => s);
    }
  }

  return [];
}

// Updated competitor rule fetch endpoint with better parsing
router.get("/products/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const authToken = process.env.AUTH_TOKEN;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: "eBay auth token is required",
      });
    }

    const xmlRequest = `
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

    const xmlResponse = await makeEBayAPICall(xmlRequest, "GetItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "GetItem");

    const item = response.Item;
    if (!item) {
      throw new Error(`Item ${itemId} not found`);
    }

    // Extract competitor rule data from ItemSpecifics
    const itemSpecifics = item.ItemSpecifics?.NameValueList || [];
    const competitorRule = parseCompetitorRuleFromSpecifics(
      itemSpecifics,
      itemId
    );
    const hasCompetitorRule = competitorRule !== null;
    getAllCompetitorRules(req, res);
    res.json({
      success: true,
      itemId,
      itemTitle: item.Title,
      hasCompetitorRule,
      competitorRule,
      itemDetails: {
        currentPrice: item.StartPrice?.Value || item.StartPrice?.__value__ || 0,
        currency:
          item.StartPrice?.__attributes__?.currencyID || item.Currency || "USD",
        listingType: item.ListingType,
        condition: item.ConditionDisplayName,
      },
    });
  } catch (error) {
    console.error("eBay Competitor Rule Fetch Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Create test competitor rule endpoint for debugging
router.post("/debug/create-test-competitor-rule/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const authToken = process.env.AUTH_TOKEN;

    // Create a test competitor rule with known field names
    const testRuleSpecifics = [
      { name: "CompetitorRuleName", value: "Test Competitor Rule" },
      { name: "MinPercentOfCurrentPrice", value: "80" },
      { name: "MaxPercentOfCurrentPrice", value: "120" },
      { name: "ExcludeCountries", value: "Germany;Italy;China" },
      { name: "ExcludeConditions", value: "Used;For parts or not working" },
      { name: "ExcludeProductTitleWords", value: "refurbished;broken;parts" },
      { name: "ExcludeSellers", value: "bad_seller_123;spam_seller_456" },
      { name: "FindCompetitorsBasedOnMPN", value: "true" },
      { name: "CompetitorRuleCreatedAt", value: new Date().toISOString() },
    ];

    const xmlRequest = `
      <?xml version="1.0" encoding="utf-8"?>
      <ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <Item>
          <ItemID>${itemId}</ItemID>
          <ItemSpecifics>
            ${testRuleSpecifics
              .map(
                (spec) => `
            <NameValueList>
              <n>${spec.name}</n>
              <Value>${spec.value}</Value>
            </NameValueList>
            `
              )
              .join("")}
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, "ReviseItem");
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, "ReviseItem");

    res.json({
      success: true,
      message: "Test competitor rule created successfully",
      itemId,
      testRuleSpecifics,
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime,
      },
    });
  } catch (error) {
    console.error("Create Test Competitor Rule Error:", error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
