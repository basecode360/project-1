import ebayApi from "../authEbay.js";


export const createReturnPolicy = async () => {
    try {
      const returnPolicyData = {
        name: "30-Day Returns",
        description: "30-day return policy with buyer paying for return shipping",
        marketplaceId: "EBAY_US",
        categoryTypes: [
          {
            name: "ALL_EXCLUDING_MOTORS_VEHICLES"
          }
        ],
        returnsAccepted: true,
        returnPeriod: {
          value: 30,
          unit: "DAY"
        },
        refundMethod: "MONEY_BACK",
        returnShippingCostPayer: "BUYER",
        returnMethod: "REPLACEMENT_OR_MONEY_BACK"
      };
  
      // Make the API call
      const url = "https://api.ebay.com/sell/account/v1/return_policy";
      const response = await ebayApi({
        method: "POST",
        url,
        data: returnPolicyData,
        headers: {
          'Content-Language': 'en-US'
        }
      });
  
      console.log("Created return policy:", response);
      return response.returnPolicyId;
    } catch (error) {
      console.error("Error creating return policy:", error.response ? error.response.data : error.message);
      throw error;
    }
  };



