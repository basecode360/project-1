import express from 'express';
import xml2js from 'xml2js';
import axios from 'axios';
import User from '../models/Users.js';
import Product from '../models/Product.js'; // Import Product model
import ManualCompetitor from '../models/ManualCompetitor.js'; // Import ManualCompetitor model
import {
  createCompetitorRule,
  applyRuleToItems,
  getAllCompetitorRules,
  createRuleForProduct, // Import createRuleForProduct
  getCompetitorRuleForProduct, // Import getCompetitorRuleForProduct
  createCompetitorRuleLogic, // Import createCompetitorRuleLogic
} from '../controllers/competitorRule.js';
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
  const response = result[operationName + 'Response'];
  if (response.Ack !== 'Success' && response.Ack !== 'Warning') {
    const errors = response.Errors;
    const errorMsg = Array.isArray(errors)
      ? errors.map((e) => e.LongMessage || e.ShortMessage).join(', ')
      : errors?.LongMessage || errors?.ShortMessage || 'Unknown error';
    throw new Error(`eBay API Error: ${errorMsg}`);
  }
  return response;
}

// Make eBay XML API call
async function makeEBayAPICall(xmlRequest, callName) {
  const response = await axios({
    method: 'post',
    url: 'https://api.ebay.com/ws/api.dll',
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
      'X-EBAY-API-CALL-NAME': callName,
      'X-EBAY-API-SITEID': '0', // US site
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
    { name: 'CompetitorRuleName', value: ruleName },
    {
      name: 'FindCompetitorsBasedOnMPN',
      value: findCompetitorsBasedOnMPN.toString(),
    },
  ];

  if (minPercentOfCurrentPrice !== undefined) {
    ruleSpecifics.push({
      name: 'MinPercentOfCurrentPrice',
      value: minPercentOfCurrentPrice.toString(),
    });
  }

  if (maxPercentOfCurrentPrice !== undefined) {
    ruleSpecifics.push({
      name: 'MaxPercentOfCurrentPrice',
      value: maxPercentOfCurrentPrice.toString(),
    });
  }

  // Handle arrays by joining with semicolons
  if (excludeCountries.length > 0) {
    ruleSpecifics.push({
      name: 'ExcludeCountries',
      value: excludeCountries.join(';'),
    });
  }

  if (excludeConditions.length > 0) {
    ruleSpecifics.push({
      name: 'ExcludeConditions',
      value: excludeConditions.join(';'),
    });
  }

  if (excludeProductTitleWords.length > 0) {
    ruleSpecifics.push({
      name: 'ExcludeProductTitleWords',
      value: excludeProductTitleWords.join(';'),
    });
  }

  if (excludeSellers.length > 0) {
    ruleSpecifics.push({
      name: 'ExcludeSellers',
      value: excludeSellers.join(';'),
    });
  }

  // Add timestamp
  ruleSpecifics.push({
    name: 'CompetitorRuleCreatedAt',
    value: new Date().toISOString(),
  });

  return ruleSpecifics;
}

/**
 * ===============================
 * 1. CREATE COMPETITOR RULE ON SPECIFIC PRODUCT
 * ===============================
 */

router.post('/products/:itemId', async (req, res) => {
  try {
    // Perform eBay XML logic first...
    const { itemId } = req.params;
    const { userId, sku, title } = req.body;

    // Create competitor rule using the extracted logic
    const rule = await createCompetitorRuleLogic({
      ...req.body,
      appliesTo: [
        {
          itemId,
          sku: sku || null,
          title: title || null,
          dateApplied: new Date(),
        },
      ],
      createdBy: userId,
    });

    // Associate the created rule with the product
    await Product.findOneAndUpdate(
      { itemId }, // Ensure this matches the product's unique identifier
      { competitorRule: rule._id },
      { new: true }
    );

    return res.status(201).json({
      success: true,
      message: 'Competitor rule created successfully and applied to product',
      data: rule,
    });
  } catch (error) {
    return res.status(400).json({
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
router.post('/apply-competitor-rule/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const ruleOptions = req.body;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in request body',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    const authToken = user.ebay.accessToken;

    if (!authToken) {
      return res
        .status(400)
        .json({ success: false, message: 'eBay auth token is required' });
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

    const getItemResponse = await makeEBayAPICall(getItemXml, 'GetItem');
    const getItemResult = await parseXMLResponse(getItemResponse);
    const item = isEBayResponseSuccessful(getItemResult, 'GetItem');

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
              .join('')}
            
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
              .join('')}
            
            <!-- Ensure Brand and Type are present -->
            ${
              !nonCompetitorRuleSpecifics.some((spec) => spec.Name === 'Brand')
                ? `
              <NameValueList>
                <Name>Brand</Name>
                <Value>YourBrandName</Value>
              </NameValueList>
            `
                : ''
            }
            
            ${
              !nonCompetitorRuleSpecifics.some((spec) => spec.Name === 'Type')
                ? `
              <NameValueList>
                <Name>Type</Name>
                <Value>YourTypeName</Value>
              </NameValueList>
            `
                : ''
            }
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, 'ReviseItem');
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, 'ReviseItem');
    createCompetitorRule(req, res);
    applyRuleToItems(req, res);
    return res.json({
      success: true,
      message:
        'Competitor rule applied successfully while preserving pricing strategy',
      itemId,
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime,
      },
    });
  } catch (error) {
    console.error('Apply Competitor Rule Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Helper function to identify competitor rule specifics
function isCompetitorRuleSpecific(name) {
  const competitorRuleSpecificNames = [
    'RuleName',
    'MinPercentOfCurrentPrice',
    'MaxPercentOfCurrentPrice',
    'ExcludeCountry',
    'ExcludeCondition',
    'ExcludeProductTitleWord',
    'ExcludeSeller',
    'FindCompetitorsBasedOnMPN',
  ];

  return competitorRuleSpecificNames.includes(name);
}

// Similar helper for pricing strategy specifics
function isPricingStrategySpecific(name) {
  const pricingStrategySpecificNames = [
    'PricingStrategyName',
    'RepricingRule',
    'NoCompetitionAction',
    'BeatBy',
    'BeatValue',
    'StayAboveBy',
    'StayAboveValue',
    'MaxPrice',
    'MinPrice',
    'IsPricingStrategy',
  ];

  return pricingStrategySpecificNames.includes(name);
}

router.post('/assign-to-all-active', async (req, res) => {
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
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in request body',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    const authToken = user.ebay.accessToken;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: 'eBay auth token is required',
      });
    }

    if (!ruleName) {
      return res.status(400).json({
        success: false,
        message: 'Rule name is required',
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

    const activeListingsResponse = await makeEBayAPICall(
      getActiveListingsXML,
      'GetMyeBaySelling'
    );
    const activeListingsResult = await parseXMLResponse(activeListingsResponse);
    const activeListingsData = isEBayResponseSuccessful(
      activeListingsResult,
      'GetMyeBaySelling'
    );

    const activeList = activeListingsData.ActiveList;
    if (!activeList || !activeList.ItemArray) {
      return res.json({
        success: true,
        message: 'No active listings found',
        assignedCount: 0,
        listings: [],
      });
    }

    const items = Array.isArray(activeList.ItemArray.Item)
      ? activeList.ItemArray.Item
      : [activeList.ItemArray.Item];

    // Step 2: Create competitor rule specifics
    const ruleSpecifics = createCompetitorRuleSpecifics(req.body);
    ruleSpecifics.push({ name: 'AssignedToAllActiveListings', value: 'true' });

    // Step 3: Apply competitor rule to each active listing
    const results = [];
    const errors = [];

    for (const item of items) {
      try {
        const itemId = item.ItemID;

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
                  .join('')}
              </ItemSpecifics>
            </Item>
          </ReviseItemRequest>
        `;

        const xmlResponse = await makeEBayAPICall(xmlRequest, 'ReviseItem');
        const result = await parseXMLResponse(xmlResponse);
        const response = isEBayResponseSuccessful(result, 'ReviseItem');
        createCompetitorRule(req, res);
        applyRuleToItems(req, res);
        results.push({
          itemId,
          title: item.Title,
          success: true,
          message: 'Competitor rule applied successfully',
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
    console.error('eBay Bulk Competitor Rule Assignment Error:', error.message);
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

router.get('/active-listings', async (req, res) => {
  const userId = req.query.userId || req.user.id;

  try {
    const listings = await Product.find({ userId, isActive: true })
      .populate('competitorRule') // Populate competitor rules
      .lean();

    // Extract and deduplicate rules
    const rules = listings
      .map((listing) => listing.competitorRule)
      .filter((rule) => rule && rule._id)
      .reduce((acc, rule) => {
        if (!acc.some((r) => r._id.toString() === rule._id.toString())) {
          acc.push(rule);
        }
        return acc;
      }, []);

    return res.json({
      success: true,
      rules,
      listings, // Include listings for UI if needed
      summary: {
        totalActiveListings: listings.length,
        listingsWithCompetitorRule: listings.filter((l) => l.competitorRule)
          .length,
        listingsWithoutCompetitorRule: listings.filter((l) => !l.competitorRule)
          .length,
      },
    });
  } catch (error) {
    console.error('Error fetching active listings with rules:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * ===============================
 * 5. UPDATE COMPETITOR RULE ON SPECIFIC PRODUCT
 * ===============================
 */

router.put('/products/:itemId', async (req, res) => {
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
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in request body',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    const authToken = user.ebay.accessToken;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: 'eBay auth token is required',
      });
    }

    if (!ruleName) {
      return res.status(400).json({
        success: false,
        message: 'Rule name is required',
      });
    }

    // Create updated competitor rule specifics
    const ruleSpecifics = createCompetitorRuleSpecifics(req.body);
    ruleSpecifics.push({
      name: 'CompetitorRuleUpdatedAt',
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
              .join('')}
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, 'ReviseItem');
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, 'ReviseItem');

    res.json({
      success: true,
      message: 'Competitor rule updated successfully on eBay product',
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
    console.error('eBay Competitor Rule Update Error:', error.message);
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

router.delete('/products/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in request body',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    const authToken = user.ebay.accessToken;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: 'eBay auth token is required',
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

    const xmlResponse = await makeEBayAPICall(xmlRequest, 'ReviseItem');
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, 'ReviseItem');

    res.json({
      success: true,
      message: 'Competitor rule deleted successfully from eBay product',
      itemId,
      deletedAt: new Date().toISOString(),
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime,
      },
    });
  } catch (error) {
    console.error('eBay Competitor Rule Deletion Error:', error.message);
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

router.delete('/delete-from-all-active', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in request body',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    const authToken = user.ebay.accessToken;

    if (!authToken) {
      return res.status(400).json({
        success: false,
        message: 'eBay auth token is required',
      });
    }

    // Get all active listings directly using eBay API
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
      'GetMyeBaySelling'
    );
    const activeListingsResult = await parseXMLResponse(activeListingsResponse);
    const activeListingsData = isEBayResponseSuccessful(
      activeListingsResult,
      'GetMyeBaySelling'
    );

    const activeList = activeListingsData.ActiveList;
    if (!activeList || !activeList.ItemArray) {
      return res.json({
        success: true,
        message: 'No active listings found',
        deletedCount: 0,
      });
    }

    const items = Array.isArray(activeList.ItemArray.Item)
      ? activeList.ItemArray.Item
      : [activeList.ItemArray.Item];

    // Filter for items with competitor rules
    const listingsWithCompetitorRules = items.filter((item) => {
      const itemSpecifics = item.ItemSpecifics?.NameValueList || [];
      const competitorRule = parseCompetitorRuleFromSpecifics(
        itemSpecifics,
        item.ItemID
      );
      return competitorRule !== null;
    });

    if (listingsWithCompetitorRules.length === 0) {
      return res.json({
        success: true,
        message: 'No active listings with competitor rules found',
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
              <ItemID>${listing.ItemID}</ItemID>
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

        const xmlResponse = await makeEBayAPICall(xmlRequest, 'ReviseItem');
        const result = await parseXMLResponse(xmlResponse);
        isEBayResponseSuccessful(result, 'ReviseItem');

        results.push({
          itemId: listing.ItemID,
          title: listing.Title,
          success: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        errors.push({
          itemId: listing.ItemID,
          title: listing.Title,
          error: error.message,
        });
      }
    }

    return res.json({
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
    console.error('eBay Competitor Rule Bulk Deletion Error:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Debug competitor rule data - add this endpoint to see what's actually stored

router.get('/debug/competitor-rule-specifics/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required as query parameter',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    const authToken = user.ebay.accessToken;

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

    const xmlResponse = await makeEBayAPICall(xmlRequest, 'GetItem');
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, 'GetItem');

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
        name.includes('competitor') ||
        name.includes('rule') ||
        name.includes('exclude') ||
        name.includes('percent') ||
        name.includes('mpn') ||
        name.includes('upc') ||
        name.includes('ean') ||
        name.includes('isbn') ||
        name === 'FindCompetitorsBasedOnMPN'
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
    console.error('Debug Competitor Rule Specifics Error:', error.message);
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

  // STRICT filtering: Only accept fields that are EXCLUSIVELY competitor rule fields
  const COMPETITOR_RULE_FIELDS = [
    // Exact field names for competitor rules (not shared with pricing strategy)
    'CompetitorRuleName',
    'MinPercentOfCurrentPrice', // Different from MinPrice (pricing strategy)
    'MaxPercentOfCurrentPrice', // Different from MaxPrice (pricing strategy)
    'ExcludeCountries',
    'ExcludeConditions',
    'ExcludeProductTitleWords',
    'ExcludeSellers',
    'FindCompetitorsBasedOnMPN',
    'CompetitorRuleCreatedAt',

    // Alternative naming conventions
    'competitor_rule_name',
    'min_percent_of_current_price',
    'max_percent_of_current_price',
    'exclude_countries',
    'exclude_conditions',
    'exclude_product_title_words',
    'exclude_sellers',
    'find_competitors_based_on_mpn',
    'competitor_rule_created_at',
  ];

  // Extract only TRUE competitor rule-related data
  specificsArray.forEach((specific) => {
    if (specific?.Name && specific?.Value) {
      const name = specific.Name;
      const value = specific.Value;

      // STRICT check: only accept fields in the whitelist
      if (COMPETITOR_RULE_FIELDS.includes(name)) {
        ruleData[name] = value;
      } else {
        // Log what we're rejecting for debugging
      }
    }
  });

  // If no actual competitor rule data found, return null
  if (Object.keys(ruleData).length === 0) {
    return null;
  }

  // Map the fields to the expected format
  const rule = {
    itemId,
    ruleName:
      ruleData.CompetitorRuleName ||
      ruleData.competitor_rule_name ||
      'Unnamed Rule',

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

  return rule;
}

// Test the fixed parser with the current data
router.get('/test-competitor-rule-parsing/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;

    // Simulate the actual data from your product
    const actualItemSpecifics = [
      { Name: 'MPN', Value: 'Does Not Apply' },
      { Name: 'CompetitorAdjustment', Value: '-5' }, // This is pricing strategy, not competitor rule
    ];

    const parsedRule = parseCompetitorRuleFromSpecifics(
      actualItemSpecifics,
      itemId
    );

    res.json({
      success: true,
      message: 'Testing parser with actual product data',
      itemId,
      actualItemSpecifics,
      parsedResult: parsedRule,
      hasCompetitorRule: parsedRule !== null,
      explanation:
        parsedRule === null
          ? 'No competitor rule data found - MPN and CompetitorAdjustment are not competitor rule fields'
          : 'Competitor rule data found and parsed successfully',
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
  if (typeof value === 'boolean') return value;
  const str = value.toString().toLowerCase();
  return str === 'true' || str === '1' || str === 'yes';
}

function parseArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  // Try to split by semicolon first, then comma
  if (typeof value === 'string') {
    if (value.includes(';')) {
      return value
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s);
    } else if (value.includes(',')) {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s);
    } else {
      return [value.trim()].filter((s) => s);
    }
  }

  return [];
}

// Updated competitor rule fetch endpoint with better parsing
router.get('/products/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required as query parameter',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    const authToken = user.ebay.accessToken;

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

    const xmlResponse = await makeEBayAPICall(xmlRequest, 'GetItem');
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, 'GetItem');

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
          item.StartPrice?.__attributes__?.currencyID || item.Currency || 'USD',
        listingType: item.ListingType,
        condition: item.ConditionDisplayName,
      },
    });
  } catch (error) {
    console.error('eBay Competitor Rule Fetch Error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Create test competitor rule endpoint for debugging
router.post('/debug/create-test-competitor-rule/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in request body',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    const authToken = user.ebay.accessToken;

    // Create a test competitor rule with known field names
    const testRuleSpecifics = [
      { name: 'CompetitorRuleName', value: 'Test Competitor Rule' },
      { name: 'MinPercentOfCurrentPrice', value: '80' },
      { name: 'MaxPercentOfCurrentPrice', value: '120' },
      { name: 'ExcludeCountries', value: 'Germany;Italy;China' },
      { name: 'ExcludeConditions', value: 'Used;For parts or not working' },
      { name: 'ExcludeProductTitleWords', value: 'refurbished;broken;parts' },
      { name: 'ExcludeSellers', value: 'bad_seller_123;spam_seller_456' },
      { name: 'FindCompetitorsBasedOnMPN', value: 'true' },
      { name: 'CompetitorRuleCreatedAt', value: new Date().toISOString() },
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
              .join('')}
          </ItemSpecifics>
        </Item>
      </ReviseItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, 'ReviseItem');
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, 'ReviseItem');

    res.json({
      success: true,
      message: 'Test competitor rule created successfully',
      itemId,
      testRuleSpecifics,
      ebayResponse: {
        itemId: response.ItemID,
        startTime: response.StartTime,
        endTime: response.EndTime,
      },
    });
  } catch (error) {
    console.error('Create Test Competitor Rule Error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Route to create and assign a competitor rule to a specific product
router.post('/create-rule/:itemId', createRuleForProduct);

// Route to fetch a competitor rule for a specific product
router.get('/fetch-rule/:itemId', getCompetitorRuleForProduct);

// Route to fetch all competitor rules
router.get('/', getAllCompetitorRules);

/**
 * ===============================
 * MANUALLY ADD COMPETITORS TO LISTING (MongoDB Version) - FIXED PRICE EXTRACTION
 * ===============================
 */
router.post('/add-competitors-manually/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { userId, competitorItemIds } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in request body',
      });
    }

    if (
      !competitorItemIds ||
      !Array.isArray(competitorItemIds) ||
      competitorItemIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'competitorItemIds array is required',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    const authToken = user.ebay.accessToken;

    // Validate each competitor item ID by fetching basic info
    const validCompetitors = [];
    const invalidCompetitors = [];

    for (const compItemId of competitorItemIds) {
      try {
        const getItemXml = `
          <?xml version="1.0" encoding="utf-8"?>
          <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
            <RequesterCredentials>
              <eBayAuthToken>${authToken}</eBayAuthToken>
            </RequesterCredentials>
            <ItemID>${compItemId.trim()}</ItemID>
            <DetailLevel>ReturnAll</DetailLevel>
            <IncludeItemSpecifics>true</IncludeItemSpecifics>
          </GetItemRequest>
        `;

        const getItemResponse = await makeEBayAPICall(getItemXml, 'GetItem');
        const getItemResult = await parseXMLResponse(getItemResponse);
        const item = isEBayResponseSuccessful(getItemResult, 'GetItem');

        const itemData = item.Item;

        // Enhanced price extraction with multiple fallbacks
        let price = 0;
        let currency = 'USD';

        // Function to extract price and currency from price object
        const extractPrice = (priceObj) => {
          if (!priceObj) return { price: 0, currency: 'USD' };

          if (typeof priceObj === 'object') {
            const priceValue = parseFloat(
              priceObj.Value || priceObj.__value__ || priceObj._ || 0
            );
            const currencyValue =
              priceObj.__attributes__?.currencyID ||
              priceObj.currencyID ||
              priceObj['@currencyID'] ||
              'USD';
            return { price: priceValue, currency: currencyValue };
          } else {
            return { price: parseFloat(priceObj) || 0, currency: 'USD' };
          }
        };

        // Try different price fields based on listing type
        if (itemData.StartPrice) {
          const extracted = extractPrice(itemData.StartPrice);
          price = extracted.price;
          currency = extracted.currency;
        } else if (itemData.CurrentPrice) {
          const extracted = extractPrice(itemData.CurrentPrice);
          price = extracted.price;
          currency = extracted.currency;
        } else if (itemData.BuyItNowPrice) {
          const extracted = extractPrice(itemData.BuyItNowPrice);
          price = extracted.price;
          currency = extracted.currency;
        } else if (itemData.ConvertedCurrentPrice) {
          const extracted = extractPrice(itemData.ConvertedCurrentPrice);
          price = extracted.price;
          currency = extracted.currency;
        }

        // Enhanced image extraction
        let imageUrl = null;
        if (itemData.PictureDetails) {
          if (itemData.PictureDetails.PictureURL) {
            imageUrl = Array.isArray(itemData.PictureDetails.PictureURL)
              ? itemData.PictureDetails.PictureURL[0]
              : itemData.PictureDetails.PictureURL;
          } else if (itemData.PictureDetails.GalleryURL) {
            imageUrl = itemData.PictureDetails.GalleryURL;
          }
        }

        // Fallback to GalleryURL if available
        if (!imageUrl && itemData.GalleryURL) {
          imageUrl = itemData.GalleryURL;
        }

        const competitorInfo = {
          itemId: compItemId.trim(),
          title: itemData.Title || 'Unknown Title',
          price: price,
          currency: currency,
          condition:
            itemData.ConditionDisplayName ||
            itemData.ConditionDescription ||
            'Unknown',
          imageUrl: imageUrl,
          productUrl:
            itemData.ViewItemURL || `https://www.ebay.com/itm/${compItemId}`,
          locale: itemData.Country || itemData.Site || 'US',
          addedAt: new Date().toISOString(),
        };

        console.log(
          `✅ Competitor ${compItemId}: ${currency} ${price} - ${itemData.Title}`
        );

        validCompetitors.push(competitorInfo);

        // Add small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(
          `❌ Failed to fetch competitor ${compItemId}:`,
          error.message
        );
        invalidCompetitors.push({
          itemId: compItemId.trim(),
          error: error.message,
        });
      }
    }

    if (validCompetitors.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid competitor items found',
        invalidCompetitors,
      });
    }

    // Store competitors in MongoDB
    try {
      // Find existing manual competitors for this item
      let manualCompetitorDoc = await ManualCompetitor.findOne({
        userId,
        itemId,
      });

      if (!manualCompetitorDoc) {
        // Create new document
        manualCompetitorDoc = new ManualCompetitor({
          userId,
          itemId,
          competitors: [],
        });
      }

      // Add new competitors (avoid duplicates)
      const existingCompetitorIds = new Set(
        manualCompetitorDoc.competitors.map((c) => c.competitorItemId)
      );

      const newCompetitors = validCompetitors.filter(
        (comp) => !existingCompetitorIds.has(comp.itemId)
      );

      if (newCompetitors.length === 0) {
        return res.json({
          success: true,
          message: 'All competitors already exist',
          itemId,
          addedCompetitors: [],
          invalidCompetitors,
          summary: {
            totalRequested: competitorItemIds.length,
            successfullyAdded: 0,
            failed: invalidCompetitors.length,
            alreadyExists: validCompetitors.length,
          },
        });
      }

      // Add new competitors to the document
      newCompetitors.forEach((comp) => {
        manualCompetitorDoc.competitors.push({
          competitorItemId: comp.itemId,
          title: comp.title,
          price: comp.price,
          currency: comp.currency,
          imageUrl: comp.imageUrl,
          productUrl: comp.productUrl,
          locale: comp.locale,
          condition: comp.condition,
        });
      });

      await manualCompetitorDoc.save();

      res.json({
        success: true,
        message: `Successfully added ${newCompetitors.length} new competitors manually`,
        itemId,
        addedCompetitors: newCompetitors,
        invalidCompetitors,
        summary: {
          totalRequested: competitorItemIds.length,
          successfullyAdded: newCompetitors.length,
          failed: invalidCompetitors.length,
          alreadyExists: validCompetitors.length - newCompetitors.length,
          totalCompetitors: manualCompetitorDoc.competitors.length,
        },
      });
    } catch (dbError) {
      console.error('MongoDB error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Failed to save competitors to database',
        error: dbError.message,
      });
    }
  } catch (error) {
    console.error('Manual Add Competitors Error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * ===============================
 * GET MANUALLY ADDED COMPETITORS FROM MONGODB
 * ===============================
 */
router.get('/get-manual-competitors/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required as query parameter',
      });
    }

    // Get manually added competitors from MongoDB
    const manualCompetitorDoc = await ManualCompetitor.findOne({
      userId,
      itemId,
    });

    if (!manualCompetitorDoc || !manualCompetitorDoc.competitors.length) {
      return res.json({
        success: true,
        itemId,
        competitors: [],
        count: 0,
      });
    }

    // Transform the data to match the expected format
    const competitors = manualCompetitorDoc.competitors.map((comp) => ({
      itemId: comp.competitorItemId,
      title: comp.title,
      price: comp.price,
      currency: comp.currency,
      imageUrl: comp.imageUrl,
      productUrl: comp.productUrl,
      locale: comp.locale,
      condition: comp.condition,
      addedAt: comp.addedAt,
      source: 'Manual',
    }));

    res.json({
      success: true,
      itemId,
      competitors,
      count: competitors.length,
    });
  } catch (error) {
    console.error('Get Manual Competitors Error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message,
      competitors: [],
    });
  }
});

/**
 * ===============================
 * DELETE MANUALLY ADDED COMPETITOR
 * ===============================
 */
router.delete(
  '/remove-manual-competitor/:itemId/:competitorItemId',
  async (req, res) => {
    try {
      const { itemId, competitorItemId } = req.params;
      const { userId } = req.query;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'userId is required as query parameter',
        });
      }

      // Find and update the document
      const result = await ManualCompetitor.updateOne(
        { userId, itemId },
        {
          $pull: {
            competitors: { competitorItemId },
          },
        }
      );

      if (result.modifiedCount === 0) {
        return res.status(404).json({
          success: false,
          message: 'Competitor not found or already removed',
        });
      }

      res.json({
        success: true,
        message: 'Competitor removed successfully',
        itemId,
        competitorItemId,
      });
    } catch (error) {
      console.error('Remove Manual Competitor Error:', error.message);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

/**
 * ===============================
 * SEARCH COMPETITORS MANUALLY (WITHOUT ADDING)
 * ===============================
 */
router.post('/search-competitors-manually/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { userId, competitorItemIds } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in request body',
      });
    }

    if (
      !competitorItemIds ||
      !Array.isArray(competitorItemIds) ||
      competitorItemIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: 'competitorItemIds array is required',
      });
    }

    // Limit to max 20 items
    const limitedItemIds = competitorItemIds.slice(0, 20);

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }
    const authToken = user.ebay.accessToken;

    // Get existing manual competitors to check for duplicates
    const existingCompetitors = await ManualCompetitor.findOne({
      userId,
      itemId,
    });

    const existingCompetitorIds = new Set(
      existingCompetitors?.competitors?.map((c) => c.competitorItemId) || []
    );

    // Search for each competitor item ID
    const foundCompetitors = [];
    const notFoundCompetitors = [];

    for (const compItemId of limitedItemIds) {
      try {
        const getItemXml = `
          <?xml version="1.0" encoding="utf-8"?>
          <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
            <RequesterCredentials>
              <eBayAuthToken>${authToken}</eBayAuthToken>
            </RequesterCredentials>
            <ItemID>${compItemId.trim()}</ItemID>
            <DetailLevel>ReturnAll</DetailLevel>
            <IncludeItemSpecifics>true</IncludeItemSpecifics>
          </GetItemRequest>
        `;

        const getItemResponse = await makeEBayAPICall(getItemXml, 'GetItem');
        const getItemResult = await parseXMLResponse(getItemResponse);
        const item = isEBayResponseSuccessful(getItemResult, 'GetItem');

        const itemData = item.Item;

        // Enhanced price extraction with multiple fallbacks
        let price = 0;
        let currency = 'USD';

        // Function to extract price and currency from price object
        const extractPrice = (priceObj) => {
          if (!priceObj) return { price: 0, currency: 'USD' };

          if (typeof priceObj === 'object') {
            const priceValue = parseFloat(
              priceObj.Value || priceObj.__value__ || priceObj._ || 0
            );
            const currencyValue =
              priceObj.__attributes__?.currencyID ||
              priceObj.currencyID ||
              priceObj['@currencyID'] ||
              'USD';
            return { price: priceValue, currency: currencyValue };
          } else {
            return { price: parseFloat(priceObj) || 0, currency: 'USD' };
          }
        };

        // Try different price fields based on listing type
        if (itemData.StartPrice) {
          const extracted = extractPrice(itemData.StartPrice);
          price = extracted.price;
          currency = extracted.currency;
        } else if (itemData.CurrentPrice) {
          const extracted = extractPrice(itemData.CurrentPrice);
          price = extracted.price;
          currency = extracted.currency;
        } else if (itemData.BuyItNowPrice) {
          const extracted = extractPrice(itemData.BuyItNowPrice);
          price = extracted.price;
          currency = extracted.currency;
        } else if (itemData.ConvertedCurrentPrice) {
          const extracted = extractPrice(itemData.ConvertedCurrentPrice);
          price = extracted.price;
          currency = extracted.currency;
        }

        // Enhanced image extraction
        let imageUrl = null;
        if (itemData.PictureDetails) {
          if (itemData.PictureDetails.PictureURL) {
            imageUrl = Array.isArray(itemData.PictureDetails.PictureURL)
              ? itemData.PictureDetails.PictureURL[0]
              : itemData.PictureDetails.PictureURL;
          } else if (itemData.PictureDetails.GalleryURL) {
            imageUrl = itemData.PictureDetails.GalleryURL;
          }
        }

        // Fallback to GalleryURL if available
        if (!imageUrl && itemData.GalleryURL) {
          imageUrl = itemData.GalleryURL;
        }

        const competitorInfo = {
          itemId: compItemId.trim(),
          title: itemData.Title || 'Unknown Title',
          price: price,
          currency: currency,
          condition:
            itemData.ConditionDisplayName ||
            itemData.ConditionDescription ||
            'Unknown',
          imageUrl: imageUrl,
          productUrl:
            itemData.ViewItemURL || `https://www.ebay.com/itm/${compItemId}`,
          locale: itemData.Country || itemData.Site || 'US',
          isAlreadyAdded: existingCompetitorIds.has(compItemId.trim()),
        };

        foundCompetitors.push(competitorInfo);

        // Add small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(
          `❌ Failed to fetch competitor ${compItemId}:`,
          error.message
        );
        notFoundCompetitors.push({
          itemId: compItemId.trim(),
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      message: `Found ${foundCompetitors.length} competitors`,
      itemId,
      foundCompetitors,
      notFoundCompetitors,
      summary: {
        totalRequested: limitedItemIds.length,
        found: foundCompetitors.length,
        notFound: notFoundCompetitors.length,
      },
    });
  } catch (error) {
    console.error('Search Competitors Error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * ===============================
 * EXECUTE COMPETITOR RULE - NEW FUNCTIONALITY
 * ===============================
 */
import CompetitorRuleEngine from '../services/competitorRuleEngine.js';

// Execute competitor rule for a specific item
router.post('/execute-rule/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in request body',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    // Get competitor rule for this item from eBay ItemSpecifics
    const xmlRequest = `
      <?xml version="1.0" encoding="utf-8"?>
      <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${user.ebay.accessToken}</eBayAuthToken>
        </RequesterCredentials>
        <ItemID>${itemId}</ItemID>
        <DetailLevel>ReturnAll</DetailLevel>
        <IncludeItemSpecifics>true</IncludeItemSpecifics>
      </GetItemRequest>
    `;

    const xmlResponse = await makeEBayAPICall(xmlRequest, 'GetItem');
    const result = await parseXMLResponse(xmlResponse);
    const response = isEBayResponseSuccessful(result, 'GetItem');

    const item = response.Item;
    const itemSpecifics = item.ItemSpecifics?.NameValueList || [];
    const competitorRule = parseCompetitorRuleFromSpecifics(
      itemSpecifics,
      itemId
    );

    if (!competitorRule) {
      return res.status(404).json({
        success: false,
        message: 'No competitor rule found for this item',
        itemId,
      });
    }

    // Execute the rule
    const engine = new CompetitorRuleEngine();
    const executionResult = await engine.executeRule(
      itemId,
      competitorRule,
      user.ebay.accessToken
    );

    res.json({
      success: true,
      message: 'Competitor rule executed successfully',
      itemId,
      rule: competitorRule,
      execution: executionResult,
    });
  } catch (error) {
    console.error('Execute Competitor Rule Error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Execute competitor rules for all items with rules
router.post('/execute-all-rules', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required in request body',
      });
    }

    // Get user's eBay token
    const user = await User.findById(userId);
    if (!user || !user.ebay.accessToken) {
      return res.status(400).json({
        success: false,
        message: 'No eBay credentials found for this user',
      });
    }

    // Get all active listings
    const getActiveListingsXML = `
      <?xml version="1.0" encoding="utf-8"?>
      <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${user.ebay.accessToken}</eBayAuthToken>
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
      'GetMyeBaySelling'
    );
    const activeListingsResult = await parseXMLResponse(activeListingsResponse);
    const activeListingsData = isEBayResponseSuccessful(
      activeListingsResult,
      'GetMyeBaySelling'
    );

    const activeList = activeListingsData.ActiveList;
    if (!activeList || !activeList.ItemArray) {
      return res.json({
        success: true,
        message: 'No active listings found',
        executedCount: 0,
        results: [],
      });
    }

    const items = Array.isArray(activeList.ItemArray.Item)
      ? activeList.ItemArray.Item
      : [activeList.ItemArray.Item];

    // Filter items that have competitor rules
    const itemsWithRules = items.filter((item) => {
      const itemSpecifics = item.ItemSpecifics?.NameValueList || [];
      const competitorRule = parseCompetitorRuleFromSpecifics(
        itemSpecifics,
        item.ItemID
      );
      return competitorRule !== null;
    });

    if (itemsWithRules.length === 0) {
      return res.json({
        success: true,
        message: 'No items with competitor rules found',
        executedCount: 0,
        results: [],
      });
    }

    // Execute rules for each item
    const engine = new CompetitorRuleEngine();
    const results = [];

    for (const item of itemsWithRules) {
      try {
        const itemSpecifics = item.ItemSpecifics?.NameValueList || [];
        const competitorRule = parseCompetitorRuleFromSpecifics(
          itemSpecifics,
          item.ItemID
        );

        const executionResult = await engine.executeRule(
          item.ItemID,
          competitorRule,
          user.ebay.accessToken
        );

        results.push({
          itemId: item.ItemID,
          title: item.Title,
          success: true,
          execution: executionResult,
        });

        // Add delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        results.push({
          itemId: item.ItemID,
          title: item.Title,
          success: false,
          error: error.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    res.json({
      success: true,
      message: `Executed competitor rules for ${successCount} items`,
      summary: {
        totalItemsWithRules: itemsWithRules.length,
        successfulExecutions: successCount,
        failedExecutions: failCount,
      },
      results,
    });
  } catch (error) {
    console.error('Execute All Rules Error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
