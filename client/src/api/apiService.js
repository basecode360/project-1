// src/api/apiService.js
import axios from "axios";

const backend_url = import.meta.env.VITE_BACKEND_URL;
const apiKey = import.meta.env.VITE_X_API_KEY;

const API_BASE_URL = `${backend_url}/api/ebay`;
const syncURL = `${backend_url}/api/sync`;
const authURL = `${backend_url}/api/auth`;

console.log(`Sync Url: ${syncURL}`);
const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

const authClient = axios.create({
  baseURL: authURL,
});

const inventory = {
  getActiveListings: async () => {
    try {
      const response = await apiClient.get("/active-listings");
      console.log("API response:", response);
      return response.data;
    } catch (error) {
      console.error("API error:", error);
      return { success: false, error: error.message };
    }
  },
  editPrice: async (requestData) => {
    try {
      const response = await apiClient.post(
        "/edit-variation-price",
        requestData
      );
      console.log("API response:", response);
      return response.data;
    } catch (error) {
      console.error("API error:", error);
      return { success: false, error: error.message };
    }
  },
  assignPricingStrategy: async (requestData) => {
    console.log(`request data  => ${requestData.targetPrice}
      `);
    try {
      const response = await apiClient.post("/pricing-strategy", requestData);
      console.log("API response:", response);
      return response.data;
    } catch (error) {
      console.error("API error:", error);
      return { success: false, error: error.message };
    }
  },
  triggerAutoSync: async (requestData) => {
    console.log(`request data  => ${requestData}
      `);
    try {
      const response = await axios.get(`${syncURL}/scheduled`, {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey, // send the key we got from client
        },
        params: requestData, // query string
      });
      console.log("API response:", response);
      return response.data;
    } catch (error) {
      console.error("API error:", error);
      return { success: false, error: error.message };
    }
  },
getCompetitorPrice: async (itemId) => {
  try {
    const response = await axios.get(`${backend_url}/api/pricing/competitor-prices/${itemId}`);
    const data = response.data?.competitorPrices || {};
    const prices = Array.isArray(data.allPrices) ? data.allPrices : [];

    return {
      price: prices.length > 0 ? `USD${parseFloat(Math.min(...prices)).toFixed(2)}` : "USD0.00",
      count: prices.length,
      allPrices: prices,
    };
  } catch (error) {
    console.error(`Error fetching competitor price for ${itemId}:`, error);
    return {
      price: "USD0.00",
      count: 0,
      allPrices: [],
    };
  }
},

};


const auth = {
  login: async (credentials) => {
    try {
      const response = await authClient.post("/login", credentials);
      console.log("API response:", response);
      return response.data;
    } catch (error) {
      console.error("API error:", error);
      return { success: false, error: error.message };
    }
  },
  logout: async () => {
    try {
      const response = await authClient.post("/logout");
      console.log("API response:", response);
      return response.data;
    } catch (error) {
      console.error("API error:", error);
      return { success: false, error: error.message };
    }
  },
  register: async (requestData) => {
    try {
      const response = await authClient.post("/register", requestData);
      console.log("API response:", response);
      return response.data;
    } catch (error) {
      console.error("API error:", error);
      return { success: false, error: error.message };
    }
  },
}
export default { inventory, auth };
