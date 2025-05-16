import axios from 'axios';
import xml2js from 'xml2js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Makes requests to the eBay Trading API
 */
const ebayTradingApi = async (options) => {
  try {
    const { 
      callname, 
      params = {},
      production = process.env.NODE_ENV === 'production'
    } = options;

    // Create XML by hand to avoid naming issues
    let xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<${callname}Request xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${process.env.EBAY_AUTH_TOKEN || process.env.REFRESH_TOKEN}</eBayAuthToken>
  </RequesterCredentials>`;
    
    // Handle ActiveList specially for GetMyeBaySelling
    if (callname === 'GetMyeBaySelling' && params.ActiveList) {
      xmlRequest += `
  <ActiveList>
    <Include>${params.ActiveList.Include}</Include>`;
      
      if (params.ActiveList.Pagination) {
        xmlRequest += `
    <Pagination>
      <EntriesPerPage>${params.ActiveList.Pagination.EntriesPerPage}</EntriesPerPage>
      <PageNumber>${params.ActiveList.Pagination.PageNumber}</PageNumber>
    </Pagination>`;
      }
      
      xmlRequest += `
  </ActiveList>`;
    }
    
    // Close the root element
    xmlRequest += `
</${callname}Request>`;

    // Determine API endpoint
    const apiEndpoint = production
      ? 'https://api.ebay.com/ws/api.dll'
      : 'https://api.sandbox.ebay.com/ws/api.dll';

    // Define headers
    const headers = {
      'Content-Type': 'text/xml',
      'X-EBAY-API-CALL-NAME': callname,
      'X-EBAY-API-SITEID': '0', // US site ID
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1119', // API version
      'X-EBAY-API-APP-NAME': process.env.CLIENT_ID
    };

    console.log('eBay Trading API Request:', xmlRequest);

    // Make the request
    const response = await axios({
      method: 'POST',
      url: apiEndpoint,
      headers,
      data: xmlRequest
    });

    console.log('eBay Trading API Response received');

    // Parse XML response to JavaScript object
    const parser = new xml2js.Parser({
      explicitArray: false,
      ignoreAttrs: true
    });

    return new Promise((resolve, reject) => {
      parser.parseString(response.data, (err, result) => {
        if (err) {
          reject(new Error(`Error parsing eBay Trading API response: ${err.message}`));
        } else {
          console.log('Parsed XML response successfully');
          
          // Extract response object
          const responseKey = Object.keys(result).find(key => key.includes('Response'));
          const responseObj = result[responseKey];
          
          // Check for errors
          if (responseObj.Ack !== 'Success' && responseObj.Ack !== 'Warning') {
            const errors = responseObj.Errors ? 
              (Array.isArray(responseObj.Errors) ? responseObj.Errors : [responseObj.Errors]) : 
              [];
            reject(new Error(JSON.stringify(errors)));
          }
          
          // Process GetMyeBaySelling response
          if (responseKey === 'GetMyeBaySellingResponse' && responseObj.ActiveList) {
            const totalEntries = parseInt(
              responseObj.ActiveList.PaginationResult?.TotalNumberOfEntries || '0', 
              10
            );
            
            let items = [];
            if (responseObj.ActiveList.ItemArray && responseObj.ActiveList.ItemArray.Item) {
              items = Array.isArray(responseObj.ActiveList.ItemArray.Item) ? 
                responseObj.ActiveList.ItemArray.Item : 
                [responseObj.ActiveList.ItemArray.Item];
            }
            
            resolve({
              total: totalEntries,
              entries: items
            });
          } else {
            resolve(responseObj);
          }
        }
      });
    });
  } catch (error) {
    console.error('eBay Trading API Error:', error.message);
    throw error;
  }
};

export default ebayTradingApi;