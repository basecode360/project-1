import ebayApi from "../helper/authEbay.js";

export const getFulfillmentPolicies = async () => {
    try {
      const url = "https://api.sandbox.ebay.com/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US";
      const response = await ebayApi({
        method: "GET",
        url,
        headers: {
          'Content-Language': 'en-US'
        }
      });
  
      console.log("Fulfillment policies:", response);
      return response;
    } catch (error) {
      console.error("Error getting fulfillment policies:", error.response ? error.response.data : error.message);
      throw error;
    }
  };