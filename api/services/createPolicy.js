import { createFulfillmentPolicy } from "../helper/policies/ebayFullfilmentPolicy.js";
import { createPaymentPolicy } from "../helper/policies/ebayPaymentPolicy.js";
import { createReturnPolicy } from "../helper/policies/ebayReturnPolicy.js";


export const createAllPolicies = async (req,res) => {
    try {
      // Create all three policies
      const fulfillmentPolicyId = await createFulfillmentPolicy();
      const paymentPolicyId = await createPaymentPolicy();
      const returnPolicyId = await createReturnPolicy();
  
      return res.status(200).json({
        "fullfilment":fulfillmentPolicyId,
        "payment":paymentPolicyId,
        "return": returnPolicyId
      });
    } catch (error) {
      const errorMessage = error.response ? error.response.data : error.message
    console.error("Error creating policies:", errorMessage);
      throw error;
    }
  };