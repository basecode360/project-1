import express from 'express';
import ebayService from '../services/ebayService.js'
import getEbayListings from '../controllers/ebayController.js'
import { createAllPolicies } from '../services/createPolicy.js';
import { getPolicy } from '../services/getPolicy.js';
import fetchProducts from '../services/getInventory.js';

const router = express.Router();

/**
 * @swagger
 * /listings-from-mongo:
 *   get:
 *     description: Retrieve a list of eBay listings
 *     responses:
 *       200:
 *         description: A list of eBay listings
 *       500:
 *         description: Internal server error
 */
router.get('/listings-from-mongo', getEbayListings);

/**
 * @swagger
 * /inventory:
 *   get:
 *     description: Get the inventory from eBay
 *     responses:
 *       200:
 *         description: List of inventory items
 *       500:
 *         description: Internal server error
 */
router.get('/inventory', fetchProducts.getInventory);

/**
 * @swagger
 * /add-product:
 *   post:
 *     description: Add a new product to eBay
 *     parameters:
 *       - in: body
 *         name: product
 *         description: Product to be added
 *         schema:
 *           type: object
 *           required:
 *             - name
 *             - price
 *           properties:
 *             name:
 *               type: string
 *               example: "Product Name"
 *             price:
 *               type: number
 *               example: 99.99
 *     responses:
 *       201:
 *         description: Product added successfully
 *       400:
 *         description: Bad request
 */
router.post('/add-product', ebayService.addProduct);

/**
 * @swagger
 * /getSingleItem/{id}:
 *   get:
 *     description: Get a single eBay item by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         description: ID of the eBay item to fetch
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Single item retrieved
 *       404:
 *         description: Item not found
 */
router.get('/getSingleItem/:id', fetchProducts.getInventoryItem);

/**
 * @swagger
 * /add-multiple-products:
 *   post:
 *     description: Add multiple products to eBay
 *     parameters:
 *       - in: body
 *         name: products
 *         description: List of products to be added
 *         schema:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Product Name"
 *               price:
 *                 type: number
 *                 example: 99.99
 *     responses:
 *       201:
 *         description: Products added successfully
 *       400:
 *         description: Bad request
 */
router.post('/add-multiple-products', ebayService.addMultipleProducts);

/**
 * @swagger
 * /editPrice:
 *   put:
 *     description: Edit the price of an eBay product
 *     parameters:
 *       - in: body
 *         name: price
 *         description: New price for the product
 *         schema:
 *           type: object
 *           required:
 *             - id
 *             - price
 *           properties:
 *             id:
 *               type: string
 *               example: "123456789"
 *             price:
 *               type: number
 *               example: 79.99
 *     responses:
 *       200:
 *         description: Price updated successfully
 *       404:
 *         description: Product not found
 */
router.put('/editPrice', ebayService.editPrice);

/**
 * @swagger
 * /deleteProduct:
 *   delete:
 *     description: Delete a product from eBay
 *     parameters:
 *       - in: query
 *         name: id
 *         description: ID of the product to delete
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product deleted successfully
 *       404:
 *         description: Product not found
 */
router.delete('/deleteProduct', ebayService.deleteProduct);

/**
 * @swagger
 * /add-Offeres-forProduct:
 *   post:
 *     description: Add offers for a product
 *     parameters:
 *       - in: body
 *         name: offer
 *         description: Offer details
 *         schema:
 *           type: object
 *           required:
 *             - productId
 *             - offerDetails
 *           properties:
 *             productId:
 *               type: string
 *               example: "123456789"
 *             offerDetails:
 *               type: string
 *               example: "Discount offer for the product"
 *     responses:
 *       201:
 *         description: Offer added successfully
 *       400:
 *         description: Bad request
 */
router.post('/add-Offeres-forProduct', ebayService.createOfferForInventoryItem);

/**
 * @swagger
 * /create-ebay-policies:
 *   post:
 *     description: Create eBay policies
 *     responses:
 *       201:
 *         description: Policies created successfully
 */
router.post('/create-ebay-policies', createAllPolicies);

/**
 * @swagger
 * /get-ebay-policies:
 *   get:
 *     description: Get all eBay policies
 *     responses:
 *       200:
 *         description: List of eBay policies
 */
// Correct way
router.get('/get-fullfilment-policies', async (req, res) => {
    try {
      const policies = await getPolicy("fulfillment");
      res.json(policies);
    } catch (error) {
      console.error("Error in fulfillment policies route:", error);
      res.status(500).json({ 
        error: "Failed to fetch fulfillment policies",
        details: error.message 
      });
    }
  });
// Correct way
router.get('/get-payment-policies', async (req, res) => {
    try {
      const policies = await getPolicy("payment");
      res.json(policies);
    } catch (error) {
      console.error("Error in payment policies route:", error);
      res.status(500).json({ 
        error: "Failed to fetch payment policies",
        details: error.message 
      });
    }
  });


  router.get('/get-return-policies', async (req, res) => {
    try {
      const policies = await getPolicy("return");
      res.json(policies);
    } catch (error) {
      console.error("Error in return policies route:", error);
      res.status(500).json({ 
        error: "Failed to fetch return policies",
        details: error.message 
      });
    }
  });


  router.post('/add-merchant-key', ebayService.createMerchantLocation);
  router.get('/get-Merchant-key', ebayService.getMerchantKey);

/**
 * @swagger
 * /active-listings:
 *   get:
 *     description: Get all active selling listings from your eBay inventory
 *     responses:
 *       200:
 *         description: A list of active selling listings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 listings:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Internal server error
 */
router.get('/active-listings', fetchProducts.getActiveListings);


router.get('/active-listingsviaFeed', fetchProducts.getActiveListingsViaFeed);



export default router;
