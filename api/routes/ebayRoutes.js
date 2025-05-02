// routes/ebayRoutes.js
import express from 'express';
import { getEbayListings } from '../controllers/ebayController.js';

const router = express.Router();

// Route to get eBay listings
router.get('/listings', getEbayListings);

export default router;
