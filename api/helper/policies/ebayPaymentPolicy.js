import ebayApi from "../authEbay.js";

export const createPaymentPolicy = async () => {
    try {
      const paymentPolicyData = {
        name: "Standard Payment Policy",
        description: "Standard payment policy for all items",
        marketplaceId: "EBAY_US",
        categoryTypes: [
          {
            name: "ALL_EXCLUDING_MOTORS_VEHICLES"
          }
        ],
        paymentMethods: [
          {
            paymentMethodType: "CASHIER_CHECK",
            recipientAccountReference: {
              referenceType: "PAYPAL_EMAIL",
              referenceId: "your-paypal-email@example.com"
            }
          }
        ],
        fullPaymentDueIn: {
          value: 1,
          unit: "DAY"
        },
        immediatePay: true
      };
  
      // Make the API call
      const url = "https://api.ebay.com/sell/account/v1/payment_policy";
      const response = await ebayApi({
        method: "POST",
        url,
        data: paymentPolicyData,
        headers: {
          'Content-Language': 'en-US'
        }
      });
  
      console.log("Created payment policy:", response);
      return response.paymentPolicyId;
    } catch (error) {
      console.error("Error creating payment policy:", error.response ? error.response.data : error.message);
      throw error;
    }
  };