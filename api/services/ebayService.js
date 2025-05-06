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


const singleItem = `https://api.sandbox.ebay.com/sell/inventory/v1/inventory_item/`
const allInventory = "https://api.sandbox.ebay.com/sell/inventory/v1/inventory_item"
// Example: Get all inventory items from your eBay store
const getInventory = async (req, res) => {
  const url = allInventory;
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
    const sku = req.params.id;
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
    "sku": "MySku1631123",
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
    const sku = req.params.id
    const { price, currency = 'USD' } = req.body;

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
    const url = allInventory;
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
    
    const createOfferUrl = "https://api.sandbox.ebay.com/sell/inventory/v1/offer";
    
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




export default { getInventory, addProduct, getInventoryItem, addMultipleProducts, editPrice, deleteProduct , createOfferForInventoryItem};

