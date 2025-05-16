import EbayListing from '../models/ebayListing.js';
import { inventoryItemsArray } from '../productadded.js';
import ebayApi from "../helper/authEbay.js"
import axios from 'axios';
import xml2js from 'xml2js';
import dotenv from 'dotenv';
dotenv.config();

// Function to fetch eBay listings from MongoDB
export const fetchEbayListings = async () => {
  try {
    const listings = await EbayListing.find();

    return listings;
  } catch (error) {
    throw new Error('Unable to fetch eBay listings');
  }
};

const singleItem = 'https://api.ebay.com/sell/inventory/v1/inventory_item/';

const addProduct = async (req, res) => {
  // Inventory API expects JSON, not XML
  const inventoryItemData = {
    "availability": {
      "shipToLocationAvailability": {
        "quantity": 100
      }
    },
    "condition": "NEW",
    "product": {
      "title": "2025 BMW i7 Electric Luxury Sedan - Premium Package",
      "description": "Brand new 2025 BMW i7 electric luxury sedan with premium package. Features advanced driving assistance, premium sound system, and extended range battery. Vehicle includes full manufacturer warranty and free delivery within 100 miles.",
      "aspects": {
        "Brand": ["BMW"],
        "Model": ["i7"],
        "Year": ["2025"],
        "Vehicle Type": ["Sedan"],
        "Fuel Type": ["Electric"],
        "Color": ["Black"],
        "Condition": ["New"]
      },
      "imageUrls": ["http://example.com/photo.jpg"]
    },
    "sku": "MySku1bmw",
    "packageWeightAndSize": {
      "dimensions": {
        "height": 6,
        "length": 12,
        "width": 8,
        "unit": "INCH"
      },
      "weight": {
        "value": 2,
        "unit": "POUND"
      }
    }, "pricingDetails": {
      "price": {
        "value": 95000.00,
        "currency": "USD"
      },
      "originalRetailPrice": {
        "value": 105000.00,
        "currency": "USD"
      }
    }
  };  

  try {
    // Use the SKU in the URL (important for the Inventory API)
    const sku = inventoryItemData.sku;
    console.log(`sku for the product ${sku}`)
    const url = `${singleItem}${sku}`;

    // Make the PUT request to add the product (Inventory API uses PUT for creating items)
    const data = await ebayApi({
      method: "PUT", // Note: Inventory API uses PUT for creating/updating items
      url: url,
      data: inventoryItemData
    });

    console.log("Added product:", data);

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error("Error adding product:", error.response ? error.response.data : error.message);

    const statusCode = error.response ? error.response.status : 500;
    const errorData = error.response ? error.response.data : { message: error.message };

    return res.status(statusCode).json({
      success: false,
      message: "Error adding product",
      error: errorData
    });
  }
}


const addMultipleProducts = async (req, res) => {
  try {
    const results = [];
    const errors = [];

    // Process each inventory item
    for (const item of inventoryItemsArray) {
      try {
        const sku = item.sku;
        const url = `${singleItem}${sku}`;

        // Make the PUT request to add the product
        const data = await ebayApi({
          method: "PUT", // Inventory API uses PUT for creating/updating items
          url: url,
          data: item,
          headers: {
            'Content-Language': 'en-US'
          }
        });

        results.push({
          sku,
          success: true,
          data
        });

        console.log(`Added product ${sku} successfully`);

      } catch (itemError) {
        const errorMessage = itemError.response ? itemError.response.data : itemError.message;
        console.error(`Error adding product ${item.sku}:`, errorMessage);

        errors.push({
          sku: item.sku,
          error: errorMessage
        });
      }
    }

    return res.status(200).json({
      success: true,
      resultsCount: results.length,
      errorsCount: errors.length,
      results,
      errors
    });

  } catch (error) {
    console.error("Error in batch operation:", error);

    return res.status(500).json({
      success: false,
      message: "Error processing batch operation",
      error: error.message
    });
  }
};


const editPrice = async (req, res) => {
  try {
    const {itemId, price, currency = 'USD' } = req.body;

    if (!itemId || !price) {
      return res.status(400).json({
        success: false,
        message: "Required fields are missing (itemId and price required)"
      });
    }

    if (isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Price must be a positive number"
      });
    }

    console.log(`Updating price for item ${itemId} to ${price} ${currency}`);
    console.log(`eBay Auth Token: ${process.env.AUTH_TOKEN}`);
    const authToken = process.env.AUTH_TOKEN;
    // For Trading API, we need to use XML
    const xmlRequest = `<?xml version="1.0" encoding="utf-8"?>
<ReviseItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>
  <Item>
    <ItemID>${itemId}</ItemID>
    <StartPrice>${price}</StartPrice>
    <Currency>${currency}</Currency>
  </Item>
</ReviseItemRequest>`;

    // Make the API call
    const response = await axios({
      method: 'POST',
      url: process.env.NODE_ENV === 'production' 
        ? 'https://api.ebay.com/ws/api.dll' 
        : 'https://api.sandbox.ebay.com/ws/api.dll',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-CALL-NAME': 'ReviseItem',
        'X-EBAY-API-SITEID': '0',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
        'X-EBAY-API-APP-NAME': process.env.CLIENT_ID
      },
      data: xmlRequest
    });

    // Parse the XML response
    const parser = new xml2js.Parser({ 
      explicitArray: false, 
      ignoreAttrs: true 
    });
    
    const result = await new Promise((resolve, reject) => {
      parser.parseString(response.data, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });

    // Check if the update was successful
    const reviseItemResponse = result.ReviseItemResponse;
    
    if (reviseItemResponse.Ack === 'Success' || reviseItemResponse.Ack === 'Warning') {
      return res.status(200).json({
        success: true,
        message: `Price updated successfully to ${price} ${currency}`,
        data: reviseItemResponse
      });
    } else {
      throw new Error(JSON.stringify(reviseItemResponse.Errors));
    }
  } catch (error) {
    
    const errorMessage = error.response?.data || error.message;
    console.error('Error updating price:', errorMessage);
    return res.status(error.response?.status || 500).json({
      success: false,
      message: "Error updating price",
      error: errorMessage
    });
  }
};


const deleteProduct = async (req, res) => {
  try {
    const url = singleItem;
    const inventoryItemsData = await ebayApi({
      url
    })

    if (!inventoryItemsData.inventoryItems) {
      return res.status().json({
        success: false,
        message: "No inventory item found"
      })
    }
    const skus = inventoryItemsData.inventoryItems.map(item => item.sku)

    if (!skus) {
      return res.status().json({
        success: false,
        message: "No skus found"
      })
    }

    let deleteArray = []
    let deleteErrors = []

    for (const sku of skus) {
      try {
        const url = `${singleItem}${sku}`
        await ebayApi({
          method: "DELETE",
          url,
        })

        deleteArray.push({
          success: true,
          sku
        })
      } catch (error) {
        const errorMessage = error.response ? error.response.data : error.message;
        console.error(`Error while deleting the product ${errorMessage}`)
        deleteErrors.push({
          success: false,
          sku
        })

      }
    }

    return res.status(200).json({
      success: true,
      errorCount: deleteErrors.length,
      successCount: deleteArray.length,
      deleteArray,
      deleteErrors
    })

  } catch (error) {
    const errorMessage = error.response ? error.response.data : error.message;
    const status = error.response ? error.response.status : 500;
    console.error(`Delete batch operation failed ${errorMessage}`)
    return res.status(status).json({
      success: false,
      message: "Error processing batch operation",
      error: error.message
    })
  }
}



// console.log(inventoryItemsArray[0].availability.shipToLocationAvailability.quantity)
const createOfferForInventoryItem = async (req, res) => {
  try {
    
    const inventoryItemSkus = inventoryItemsArray.map(item => item.sku);
    
    if (!inventoryItemSkus) {
      return res.status(404).json({
        success: false,
        message: `No inventory sku found`
      });
    }
    
    const createOfferUrl = "https://api.ebay.com/sell/inventory/v1/offer";
    
    // Create the offer data
    const i = 0;
    for (const sku of inventoryItemSkus) {
      
      const offerData = {
        sku: sku,
        marketplaceId: "EBAY_US",
        format: "FIXED_PRICE",
        availableQuantity: inventoryItemsArray[i].availability.shipToLocationAvailability.quantity,
        categoryId: "33997", // Electric Vehicles category - you need the correct category ID
        listingDescription: inventoryItemsArray[i].product.description,
        listingPolicies: {
          fulfillmentPolicyId: "YOUR_FULFILLMENT_POLICY_ID", // You must create these policies first
          paymentPolicyId: "YOUR_PAYMENT_POLICY_ID",
          returnPolicyId: "YOUR_RETURN_POLICY_ID"
        },
        pricingSummary: {
          price: {
            value: inventoryItemsArray[i].pricingDetails.price.value,
            currency: inventoryItemsArray[i].pricingDetails.price.currency
          }
        },
        merchantLocationKey: "YOUR_MERCHANT_LOCATION_KEY" // You need to create this first
      };

      const data = await ebayApi({
        method: "POST",
        url: createOfferUrl,
        data: offerData,
        headers: {
          'Content-Language': 'en-US'
        }
      });
      
      console.log(`Created offer for SKU ${sku}`);
      i++;
    }
      return res.status(200).json({
        success: true,
        message: `Offer created successfully for SKU: ${sku}`,
        data
      });
    
    // Create the offer using eBay API
    
  } catch (error) {
    console.error("Error creating offer:", error.response ? error.response.data : error.message);
    
    const statusCode = error.response ? error.response.status : 500;
    const errorData = error.response ? error.response.data : { message: error.message };
    
    return res.status(statusCode).json({
      success: false,
      message: "Error creating offer",
      error: errorData
    });
  }
};



export default { addProduct, addMultipleProducts, editPrice, deleteProduct , createOfferForInventoryItem };

