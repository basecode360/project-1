// controllers/ebayController.js

import { fetchEbayListings } from '../services/ebayService.js';

/**
 * GET /api/active-listings
 *   → Returns all active listings fetched directly from eBay
 */
const getEbayListings = async (req, res) => {
  try {
    const listings = await fetchEbayListings();
    return res.status(200).json({
      success: true,
      data: listings,
    });
  } catch (error) {
    console.error('Error fetching eBay listings:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error fetching eBay listings',
      error: error.message,
    });
  }
};

export default getEbayListings;
