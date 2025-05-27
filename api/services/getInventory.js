import ebayApi from "../helper/authEbay.js"
import axios from 'axios';
import xml2js from 'xml2js';
import dotenv from 'dotenv';

dotenv.config();



// Example: Get all inventory items from your eBay store

const getInventoryItem = async (req, res) => {
  try {
    const itemId = req.params.id;
    console.log(`item id = > ${itemId}`)

    const xmlPayload = `<?xml version="1.0" encoding="utf-8"?>
      <GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${process.env.AUTH_TOKEN}</eBayAuthToken>
        </RequesterCredentials>
        <ItemID>${itemId}</ItemID>
        <DetailLevel>ReturnAll</DetailLevel>
        <WarningLevel>High</WarningLevel>
      </GetItemRequest>`;

    const { data: xmlResponse } = await axios.post(
      'https://api.ebay.com/ws/api.dll',
      xmlPayload,
      {
        headers: {
          'Content-Type': 'text/xml',
          'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
          'X-EBAY-API-DEV-NAME': process.env.DEV_ID,
          'X-EBAY-API-APP-NAME': process.env.CLIENT_ID,
          'X-EBAY-API-CERT-NAME': process.env.CLIENT_SECRET,
          'X-EBAY-API-CALL-NAME': 'GetItem',
          'X-EBAY-API-SITEID': '0',
        },
      }
    );

    // Convert XML to JS object
    const itemData = await xml2js.parseStringPromise(xmlResponse, { explicitArray: false });

    return res.status(200).json({
      success: true,
      itemData,
    });

  } catch (error) {
    const errorMessage = error.response ? error.response.data : error.message;
    const statusCode = error.response ? error.response.status : 500;

    console.log(`Error occurred while fetching the product: ${errorMessage}`);
    return res.status(statusCode).json({
      success: false,
      message: "Error fetching product",
      error: errorMessage,
    });
  }
};



  const getActiveListings = async (req, res) => {
    try {
      const authToken = process.env.AUTH_TOKEN; // Make sure this is set
      
      // Simple XML request
      const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
      <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${authToken}</eBayAuthToken>
        </RequesterCredentials>
        <ActiveList>
          <Include>true</Include>
        </ActiveList>
      </GetMyeBaySellingRequest>`;
      
      // Make the API call
      const response = await axios({
        method: 'POST',
        url: 'https://api.ebay.com/ws/api.dll', // or sandbox URL
        headers: {
          'Content-Type': 'text/xml',
          'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
          'X-EBAY-API-SITEID': '0',
          'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
          'X-EBAY-API-APP-NAME': process.env.CLIENT_ID
        },
        data: xmlRequest
      });
      
      // Parse the XML response
      const result = await new Promise((resolve, reject) => {
        const parser = new xml2js.Parser({ 
          explicitArray: false, 
          ignoreAttrs: true 
        });
        
        parser.parseString(response.data, (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      });
      
      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error with Trading API:', error);
      return res.status(500).json({
        success: false,
        message: 'Error fetching listings via Trading API',
        error: error.message
      });
    }
  };


  const getActiveListingsViaFeed = async (req, res) => {
    try {
      console.log('Creating feed request for active listings...');
      
      // Create a feed request with the correct feedType
      const createFeedResponse = await ebayApi({
        method: 'POST',
        url: '/sell/feed/v1/task',
        data: {
          feedType: 'ACTIVE_INVENTORY_REPORT', // This is the correct value for active listings
          schemaVersion: '1.0'
          // Note: filterCriteria is optional and can be omitted
        }
      });
      
      console.log('Feed request response:', JSON.stringify(createFeedResponse, null, 2));
      
      if (!createFeedResponse || !createFeedResponse.taskId) {
        throw new Error('Failed to create feed task - no taskId returned');
      }
      
      const taskId = createFeedResponse.taskId;
      console.log(`Feed task created with ID: ${taskId}`);
      
      // In a real-world scenario, you would implement polling here
      // since feed generation can take some time. For this example,
      // we'll just return the taskId and instruct the client to check later.
      
      return res.status(202).json({
        success: true,
        message: 'Feed generation initiated',
        taskId: taskId,
        instructions: 'Check the feed status using the GET /sell/feed/v1/task/{taskId} endpoint, then download the report when ready.'
      });
    } catch (error) {
      console.error('Error creating feed request:', error.response?.data || error.message);
      return res.status(500).json({
        success: false,
        message: 'Error fetching listing feed',
        error: error.response?.data || error.message
      });
    }
  };

//   const singleItem = 'https://api.ebay.com/sell/inventory/v1/inventory_item/';
// const getInventoryItem = async (req, res) => {
//     try {
//       const sku = req.params.id;
//       console.log('sku => ', sku)
//       const url = `${singleItem}${sku}`;
  
//       const itemData = await ebayApi({
//         url: url,
//       })
  
//       console.log("fetched single product form ebay", itemData)
//       return res.status(200).json({
//         success: true,
//         itemData
//       })
  
//     } catch (error) {
//       const errorMessage = error.response ? error.response.data : error.message;
//       const statusCode = error.response ? error.response.status : 500; // Default to 500 if no response status
  
//       console.log(`Error occurred while fetching the product: ${errorMessage}`);
//       return res.status(statusCode).json({
//         success: false,
//         message: "Error fetching product",
//         error: error.response ? error.response.data : error.message
//       })
//     }
//   }

  

export default { getInventoryItem, getActiveListings, getActiveListingsViaFeed };
