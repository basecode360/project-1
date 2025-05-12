import ebayApi from "../helper/authEbay.js";

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