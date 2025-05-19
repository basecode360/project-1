import ebayApi from "../helper/authEbay.js";
import axios from "axios";

// export const getFulfillmentPolicies = async () => {
//     try {
//       const url = "https://api.ebay.com/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US";
//       const response = await ebayApi({
//         method: "GET",
//         url,
//         headers: {
//           'Content-Language': 'en-US'
//         }
//       });
  
//       console.log("Fulfillment policies:", response);
//       return response;
//     } catch (error) {
//       console.error("Error getting fulfillment policies:", error.response ? error.response.data : error.message);
//       throw error;
//     }
//   };



  export const getPolicy = async (policyType, marketplaceId = "EBAY_US") => {
    try {
      const url = `https://api.ebay.com/sell/account/v1/${policyType}_policy?marketplace_id=${marketplaceId}`;
      const response = await ebayApi({
        method: "GET",
        url,
        headers: {
          'Content-Language': 'en-US'
        }
      });
  
      console.log(`${policyType} policies:`, response);
      return response;
    } catch (error) {
      console.error(`Error getting ${policyType} policies:`, error.response ? error.response.data : error.message);
      throw error;
    }
  };



  export const checkAuthToken = async (req, res) => {
  try {
    const {AUTH_TOKEN, CLIENT_ID, NODE_ENV} = process.env;
    console.log(`auth token => ${AUTH_TOKEN}, client id => ${CLIENT_ID}, env => ${NODE_ENV}`)
    if (!AUTH_TOKEN) {
      return res.status(400).json({
        success: false,
        message: "Auth token is required"
      });
    }

    // Simple XML request using GeteBayOfficialTime
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayOfficialTimeRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${AUTH_TOKEN}</eBayAuthToken>
  </RequesterCredentials>
</GeteBayOfficialTimeRequest>`;

    // Make API call with timeout and retry logic
    const response = await axios({
      method: 'POST',
      url:'https://api.ebay.com/ws/api.dll',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'X-EBAY-API-CALL-NAME': 'GeteBayOfficialTime',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-APP-NAME': CLIENT_ID,
        'User-Agent': 'Mozilla/5.0 (compatible; eBay-API-Client)',
        'Connection': 'keep-alive'
      },
      data: xmlRequest,
      timeout: 30000, // 30 second timeout
      maxRedirects: 5,
      validateStatus: function (status) {
        return status < 500; // Accept any status code less than 500
      }
    });

    // Parse XML response
    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
    const result = await new Promise((resolve, reject) => {
      parser.parseString(response.data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    // Check response status
    const timeResponse = result.GeteBayOfficialTimeResponse;
    const isValid = timeResponse.Ack === 'Success' || timeResponse.Ack === 'Warning';

    if (isValid) {
      return res.status(200).json({
        success: true,
        message: "Auth token is valid",
        valid: true,
        timestamp: timeResponse.Timestamp
      });
    } else {
      return res.status(401).json({
        success: false,
        message: "Auth token is invalid",
        valid: false,
        errors: timeResponse.Errors
      });
    }

  } catch (error) {
    console.error('Token check error:', error.message);
    
    return res.status(500).json({
      success: false,
      message: "Error checking token",
      valid: false,
      error: error.message
    });
  }
};

