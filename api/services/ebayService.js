// // services/ebayService.js
// import axios from 'axios';
// import EbayListing from '../models/ebayListing.js';

// // Replace with your eBay API credentials and store information
// const ebayApiUrl = 'https://api.ebay.com/ws/api.dll'; // eBay API endpoint
// const appId = 'YOUR_EBAY_APP_ID';  // Your eBay Application ID (App ID)
// const storeName = 'YOUR_EBAY_STORE_NAME';  // Your eBay store name

// // Function to fetch eBay listings from your store
// export const fetchEbayListings = async () => {
//   try {
//     const response = await axios.get(ebayApiUrl, {
//       params: {
//         _appid: appId,
//         storeName: storeName,
//       },
//     });

//     const listings = response.data.items;

//     const savedListings = [];
//     for (const listing of listings) {
//       const newListing = new EbayListing({
//         itemId: listing.itemId,
//         title: listing.title,
//         price: listing.price,
//         availability: listing.availability,
//         imageUrl: listing.imageUrl,
//         ebayUrl: listing.ebayUrl,
//       });

//       await newListing.save();
//       savedListings.push(newListing);
//     }

//     return savedListings;
//   } catch (error) {
//     throw new Error('Unable to fetch eBay listings');
//   }
// };





// services/ebayService.js
import EbayListing from '../models/ebayListing.js';

// Function to fetch eBay listings from MongoDB
export const fetchEbayListings = async () => {
  try {
    const listings = await EbayListing.find();

    return listings;
  } catch (error) {
    throw new Error('Unable to fetch eBay listings');
  }
};
