import ebayApi from "../authEbay.js";

export const createFulfillmentPolicy = async () => {
  try {
    const fulfillmentPolicyData = {
      name: "Simple Shipping Policy",
      description: "Basic shipping policy for all items",
      marketplaceId: "EBAY_US",
      categoryTypes: [
        {
          name: "ALL_EXCLUDING_MOTORS_VEHICLES"
        }
      ],
      handlingTime: {
        value: 3,
        unit: "DAY"
      },
      shippingOptions: [
        {
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [
            {
              sortOrder: 1,
              shippingServiceCode: "USPSPriority",
              shippingCost: {
                value: "9.99",
                currency: "USD"
              },
              additionalShippingCost: {
                value: "1.99",
                currency: "USD"
              }
            }
          ]
        }
      ]
    };

    // Make the API call
    const url = "https://api.sandbox.ebay.com/sell/account/v1/fulfillment_policy";
    const response = await ebayApi({
      method: "POST",
      url,
      data: fulfillmentPolicyData,
      headers: {
        'Content-Language': 'en-US'
      }
    });

    console.log("Created fulfillment policy:", response);
    return response.fulfillmentPolicyId;
  } catch (error) {
    console.error("Error creating fulfillment policy:", error.response ? error.response.data : error.message);
    throw error;
  }
};