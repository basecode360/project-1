// src/api/apiService.js
import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api/ebay';

const apiClient = axios.create({
  baseURL: API_BASE_URL
});

const inventory = {
  getActiveListings: async () => {
    try {
      const response = await apiClient.get('/active-listings');
      console.log('API response:', response);
      return response.data;
    } catch (error) {
      console.error('API error:', error);
      return { success: false, error: error.message };
    }
  },
  editPrice: async (requestData) => {
    try {
      const response = await apiClient.post(
        '/edit-variation-price',
        requestData
      );
      console.log('API response:', response);
      return response.data;
    } catch (error) {
      console.error('API error:', error);
      return { success: false, error: error.message };
    }
  },
  assignPricingStrategy: async (requestData) => {
    console.log(`request data  => ${requestData.targetPrice}
      `)
    try {
      const response = await apiClient.post(
        '/pricing-strategy',
        requestData
      );
      console.log('API response:', response);
      return response.data;
    } catch (error) {
      console.error('API error:', error);
      return { success: false, error: error.message };
    }
  }
};


export default { inventory };



