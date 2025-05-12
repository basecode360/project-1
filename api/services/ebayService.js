import EbayListing from '../models/ebayListing.js';
import { inventoryItemsArray } from '../productadded.js';
import ebayApi from "../helper/authEbay.js"
// Function to fetch eBay listings from MongoDB
export const fetchEbayListings = async () => {
  try {
    const listings = await EbayListing.find();

    return listings;
  } catch (error) {
    throw new Error('Unable to fetch eBay listings');
  }
};


const singleItem = `https://api.ebay.com/sell/inventory/v1/inventory_item/`
// Example: Get all inventory items from your eBay store
const getInventory = async (req, res) => {
  const url = singleItem;
  try {
    // This is the correct inventory endpoint

    const data = await ebayApi({
      method: "GET",
      url,
    });
    console.log("Inventory:", data);
    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error(
      "Error fetching inventory:",
      error.response?.data || error.message
    );
    throw error;
  }
}


const getInventoryItem = async (req, res) => {
  try {
    const sku = "MySku1bmw";
    console.log('sku => ', sku)
    const url = `${singleItem}${sku}`;

    const itemData = await ebayApi({
      url: url,
    })

    console.log("fetched single product form ebay", itemData)
    return res.status(200).json({
      success: true,
      itemData
    })

  } catch (error) {
    const errorMessage = error.response ? error.response.data : error.message;
    const statusCode = error.response ? error.response.status : 500; // Default to 500 if no response status

    console.log(`Error occurred while fetching the product: ${errorMessage}`);
    return res.status(statusCode).json({
      success: false,
      message: "Error fetching product",
      error: error.response ? error.response.data : error.message
    })
  }
}



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
    "imageUrls": ["https://posit.co/wp-content/themes/Posit/public/markdown-blogs/creating-apis-for-data-science-with-plumber/images/image1.png"]
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
      "value": 5000.00,
      "currency": "USD"
    },
    "originalRetailPrice": {
      "value": 15000.00,
      "currency": "USD"
    }
  }
};  
const addProduct = async (req, res) => {
  // Inventory API expects JSON, not XML
  try {
    // Use the SKU in the URL (important for the Inventory API)
    const sku = inventoryItemData.sku;
    console.log(`sku for the product ${sku}`);
    const url = `${singleItem}${sku}`;

    // Make the PUT request to add the product (Inventory API uses PUT for creating items)
    const data = await ebayApi({
      method: "PUT", // Note: Inventory API uses PUT for creating/updating items
      url: url,
      data: inventoryItemData
    });

    console.log("Added product:", data);
    
    try {
      // Changed condition: we want to create an offer if data exists (not if !data)
      if (!data) {
        const publishResult = await createAndPublishOffer(sku);
        console.log("Offer published:", publishResult);
        
        return res.status(200).json({
          success: true,
          inventoryData: data,
          offerData: publishResult
        });
      }
    } catch (offerError) {
      console.error("Error in offer creation/publishing:", offerError);
      console.error("Full offer error details:", offerError.response ? offerError.response.data : offerError.message);
      
      // Still return 200 since the inventory item was created successfully
      return res.status(200).json({
        success: true,
        inventoryData: data,
        offerError: {
          message: "Product was added to inventory but offer creation failed",
          details: offerError.response ? offerError.response.data : offerError.message
        }
      });
    }
    
    return res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error("Error adding product:", error);
    console.error("Error response data:", error.response ? error.response.data : "No response data");
    console.error("Error message:", error.message);

    const statusCode = error.response ? error.response.status : 500;
    const errorData = error.response ? error.response.data : { message: error.message };

    return res.status(statusCode).json({
      success: false,
      message: "Error adding product",
      error: errorData
    });
  }
};

const createAndPublishOffer = async (sku) => {
  // Step 1: Create an offer for the inventory item
  const offerData = {
    sku: sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId: "177834",  // Replace with appropriate category ID
    listingDescription: inventoryItemData.product.description,
    includeCatalogProductDetails: true,
    listingDuration: "GTC",
    listingPolicies: {
      fulfillmentPolicyId: "223145237024",
      paymentPolicyId: "245816178024",
      returnPolicyId: "223145092024"
    },
    pricingSummary: {
      price: inventoryItemData.pricingDetails.price
    },
    merchantLocationKey: "warehouse-001"  // Replace with your location key
  };

  try {
    // Create the offer
    console.log("Creating offer with data:", JSON.stringify(offerData, null, 2));
    const createOfferUrl = "https://api.ebay.com/sell/inventory/v1/offer";
    const offerResponse = await ebayApi({
      method: "POST",
      url: createOfferUrl,
      data: offerData
    });
    
    console.log("Offer created successfully:", offerResponse);
    
    if (!offerResponse || !offerResponse.offerId) {
      throw new Error("Failed to get offerId from create offer response");
    }

    // Step 2: Publish the offer
    const offerId = offerResponse.offerId;
    const publishOfferUrl = `https://api.ebay.com/sell/inventory/v1/offer/${offerId}/publish`;
    
    console.log(`Publishing offer with ID: ${offerId}`);
    const publishResponse = await ebayApi({
      method: "POST",
      url: publishOfferUrl
    });
    
    console.log("Offer published successfully:", publishResponse);
    
    // Check offer status
    try {
      const offerStatus = await checkOfferStatus(offerId);
      console.log(`Status check for offer ${offerId}:`, offerStatus);
      
      return {
        createResponse: offerResponse,
        publishResponse: publishResponse,
        statusResponse: offerStatus
      };
    } catch (statusError) {
      console.error(`Error checking status for offer ${offerId}:`, statusError.message);
      console.error("Status check error details:", statusError.response ? statusError.response.data : "No response data");
      
      // Return the publish response even if status check fails
      return {
        createResponse: offerResponse,
        publishResponse: publishResponse,
        statusError: statusError.message
      };
    }
  } catch (error) {
    console.error("Error in createAndPublishOffer:", error);
    console.error("Error details:", error.response ? error.response.data : "No response data");
    console.error("Error message:", error.message);
    
    // Re-throw the error to be caught by the calling function
    throw {
      message: error.message,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data
      } : null
    };
  }
};

const checkOfferStatus = async (offerId) => {
  try {
    const statusUrl = `https://api.ebay.com/sell/inventory/v1/offer/${offerId}`;
    const statusResponse = await ebayApi({
      method: "GET",
      url: statusUrl
    });
    
    console.log(`Offer ${offerId} status details:`, statusResponse);
    return statusResponse;
  } catch (error) {
    console.error(`Error checking offer status for offer ${offerId}:`, error);
    console.error("Status error details:", error.response ? error.response.data : "No response data");
    
    // Re-throw with more context
    throw {
      message: `Failed to check status for offer ${offerId}: ${error.message}`,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data
      } : null
    };
  }
};


const getMerchantKey = async (req,res) => {
    let url = "https://api.ebay.com/sell/inventory/v1/location"

    try {
      let merchantKey = await ebayApi({
        url
      })
  
      return res.status(200).send({
        success: true,
        message: "Fetched merchant key successfully",
        data: merchantKey,
      })
  
    } catch (error) {
      const errorMessage = error.response ? error.response.data : error.message
      return res.status(500).send({
        success: false,
        message: errorMessage,
      })
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
    const sku = req.params.id
    const { price, currency = 'USD' } = req.body;
    console.log('price')
    if (!sku || !price) {
      return res.status(400).json({
        success: false,
        message: "Required fileds are not given"
      })
    }

    if (isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Price is not in correct format"
      })
    }

    console.log("Sku of product => ", sku)
    const url = `${singleItem}${sku}`;

    const itemData = await ebayApi({
      url: url,
    })


    console.log("fetched single product form ebay", itemData)
    const updatedProduct = {
      ...itemData,
      availability: {
        shipToLocationAvailability: {
          allocationByFormat: {
            fixedPrice: price
          }
        }
      }
    }

    // const updatedPrice = await ebayApi({
    //   method: "PUT",
    //   url,
    //   data: updatedProduct
    // })
    console.log("product updated =>" , updatedProduct)
    return res.status(200).json({
      success: true,
      updatedProduct
    })

  } catch (error) {
    const status = error.response ? error.response.status : 500;
    const errorMessage = error.response ? error.response.status : error.response.data;
    return res.status(status).json({
      success: false,
      message: "Error edit price ",
      error: errorMessage
    })
  }
}


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




// Function to create a merchant location
const createMerchantLocation = async (req, res) => {
  // Choose a unique key for your location
  const merchantLocationKey = "warehouse-001";
  
  // Location data - modify with your actual address
  const locationData = {
    location: {
      address: {
        addressLine1: "123 Main Street",
        city: "Karachi",
        stateOrProvince: "Sindh",
        postalCode: "75330",
        country: "PK"  // Use your country code
      }
    },
    locationInstructions: "Standard shipping location",
    name: "Main Warehouse",
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"]
  };

  try {
    const url = `https://api.ebay.com/sell/inventory/v1/location/${merchantLocationKey}`;
    
    const response = await ebayApi({
      method: "POST",
      url: url,
      data: locationData
    });
    
    console.log("Location created:", response);
    
    return res.status(200).json({
      success: true,
      merchantLocationKey: merchantLocationKey,
      response: response
    });
  } catch (error) {
    console.error("Error creating location:", error.response ? error.response.data : error.message);
    
    return res.status(500).json({
      success: false,
      message: "Error creating merchant location",
      error: error.response ? error.response.data : error.message
    });
  }
};



const getCategoryTree = async () => {
  try {
    // 0 is the ID for the eBay US category tree
    const url = "https://api.ebay.com/commerce/taxonomy/v1/category_tree/0";
    const categoryTree = await ebayApi({
      method: "GET",
      url: url
    });
    console.log("Category tree:", categoryTree);
    return categoryTree;
  } catch (error) {
    console.error("Error fetching category tree:", error.response ? error.response.data : error.message);
    throw error;
  }
};


const getCategorySuggestions = async () => {
  try {
    const url = "https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions";
    const response = await ebayApi({
      method: "POST",
      url: url,
      data: {
        "keywords": "electric car BMW i7" 
      }
    });
    console.log("Category suggestions:", response);
    return response;
  } catch (error) {
    console.error("Error getting category suggestions:", error.response ? error.response.data : error.message);
    throw error;
  }
};



export default { getInventory, addProduct, getInventoryItem, addMultipleProducts, editPrice, deleteProduct , createOfferForInventoryItem, getMerchantKey, createMerchantLocation};

