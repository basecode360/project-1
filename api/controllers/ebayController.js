// controllers/ebayController.js
import { fetchEbayListings } from '../services/ebayService.js';

export const getEbayListings = async (req, res) => {
  try {
    const listings = await fetchEbayListings();
    return res.status(200).json({
      success: true,
      data: listings
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching eBay listings',
      error: error.message,
    });
  }
};

