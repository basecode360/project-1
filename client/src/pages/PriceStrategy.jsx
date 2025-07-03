// src/pages/PriceStrategy.jsx - SIMPLIFIED without Zustand complexity
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CircularProgress, Box, Typography } from '@mui/material';
import Form from '../componentsForEditListing/StrategyForm';
import ListingsTable from '../componentsForEditListing/ListingsTable';
import apiService from '../api/apiService';

export default function PriceStrategy() {
  const { productId } = useParams();
  const [currentProduct, setCurrentProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch product data directly from API - no Zustand dependency
  useEffect(() => {
    const fetchProduct = async () => {
      if (!productId) {
        setError('No product ID provided');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Fetch fresh listings data
        const response = await apiService.inventory.getActiveListings();

        if (response.success) {
          let ebayListings = [];

          if (response.data?.GetMyeBaySellingResponse?.ActiveList?.ItemArray) {
            const itemArray =
              response.data.GetMyeBaySellingResponse.ActiveList.ItemArray;
            if (Array.isArray(itemArray.Item)) {
              ebayListings = itemArray.Item;
            } else if (itemArray.Item) {
              ebayListings = [itemArray.Item];
            }
          }

          // Find the specific product
          const targetItem = ebayListings.find(
            (item) => item.ItemID === productId
          );

          if (targetItem) {
            // Format the product for use
            const formattedProduct = {
              productTitle: targetItem.Title,
              productId: targetItem.ItemID,
              sku: targetItem.SKU || ' ',
              status: [
                targetItem.SellingStatus?.ListingStatus || 'Active',
                targetItem.ConditionDisplayName || 'New',
              ],
              price: `USD ${parseFloat(targetItem.BuyItNowPrice || 0).toFixed(
                2
              )}`,
              qty: parseInt(targetItem.Quantity || '0', 10),
              myPrice: `USD ${parseFloat(targetItem.BuyItNowPrice || 0).toFixed(
                2
              )}`,
            };

            setCurrentProduct(formattedProduct);
          } else {
            setError(`Product ${productId} not found in your active listings`);
          }
        } else {
          setError('Failed to fetch eBay listings');
        }
      } catch (err) {
        console.error('Error fetching product:', err);
        setError('Error loading product: ' + err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [productId]);

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '50vh',
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography variant="body1" color="textSecondary">
          Loading strategy for product {productId}...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '50vh',
          gap: 2,
          textAlign: 'center',
          p: 3,
        }}
      >
        <Typography variant="h6" color="error">
          Error Loading Product
        </Typography>
        <Typography variant="body1" color="textSecondary">
          {error}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Product ID: {productId}
        </Typography>
      </Box>
    );
  }

  if (!currentProduct) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '50vh',
          gap: 2,
          textAlign: 'center',
          p: 3,
        }}
      >
        <Typography variant="h6" color="warning.main">
          Product Not Found
        </Typography>
        <Typography variant="body1" color="textSecondary">
          Could not find product with ID: {productId}
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <Form product={currentProduct} />
      <ListingsTable />
    </>
  );
}
