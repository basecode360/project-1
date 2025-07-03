// src/componentsForHome/ListingsTable.jsx - FIXED LOADING ISSUES
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Link,
  Box,
  Container,
  CircularProgress,
  AlertTitle,
  Alert,
  Button,
  IconButton,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  History as HistoryIcon,
  TrendingUp,
  TrendingDown,
  TrendingFlat,
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import useProductStore from '../store/productStore';
import useAuthHook from '../store/authStore';

// Import your API service
import apiService from '../api/apiService';
import CompetitorCount from './CompetitorCount';
const { pricingStrategies } = apiService;

// CRITICAL: Lightning-fast auth check to prevent delays
const lightningAuthCheck = () => {
  try {
    const authStore = JSON.parse(localStorage.getItem('auth-store') || '{}');
    const appJwt = localStorage.getItem('app_jwt');
    const userId = localStorage.getItem('user_id');
    return !!(authStore.state?.user || appJwt || userId);
  } catch {
    return false;
  }
};

export default function ListingsTable({
  currentPage = 1,
  itemsPerPage = 10,
  onTotalPagesChange,
  mode = 'listings',
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthHook();
  const [rows, setRows] = useState([]);
  const [listingsLoading, setListingsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [paginatedRows, setPaginatedRows] = useState([]);
  const [sortBy, setSortBy] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [autoSyncInProgress, setAutoSyncInProgress] = useState(false);
  const [strategiesLoading, setStrategiesLoading] = useState(false);

  // FIXED: Add refresh control state
  const [lastRefreshTime, setLastRefreshTime] = useState(0);
  const [lastStrategyRefresh, setLastStrategyRefresh] = useState(0);
  const mountedRef = useRef(true);

  // FIXED: Refresh cooldown periods
  const REFRESH_COOLDOWN = 30000; // 30 seconds minimum between refreshes
  const STRATEGY_REFRESH_COOLDOWN = 60000; // 60 seconds for strategy refreshes
  const BACKGROUND_MONITOR_COOLDOWN = 300000; // 5 minutes for background monitoring

  const {
    loading,
    getFilteredProducts,
    sortBy: storeSortBy,
    sortOrder,
    modifySearch,
    modifyProductsArray,
    modifyProductsId,
    modifyProductsObj,
    modifyProductsIdWithNavigation,
    modifyProductsObjWithNavigation,
    updateProductById,
    batchUpdateProducts,
    setProductsLoading,
    AllProducts,
    searchProduct,
  } = useProductStore();

  // CRITICAL: FIXED fetchEbayListings with guaranteed loading state clear
  const fetchEbayListings = useCallback(
    async (force = false) => {
      console.log('📋 ListingsTable: ⚡ Starting FIXED fetchEbayListings...');

      // LIGHTNING PATH: Skip auth delays if we have stored credentials
      const hasStoredAuth = lightningAuthCheck();
      if (!user && !hasStoredAuth) {
        console.log('📋 ListingsTable: ❌ No auth available, skipping fetch');
        setListingsLoading(false); // ALWAYS clear loading state
        setError('Authentication required. Please log in.');
        return;
      }

      if (!user && hasStoredAuth) {
        console.log(
          '📋 ListingsTable: ⚡ No user state but has stored auth - proceeding anyway'
        );
      }

      const now = Date.now();

      // Check cooldown period unless forced
      if (!force && now - lastRefreshTime < REFRESH_COOLDOWN) {
        console.log(
          '⏳ Skipping fetchEbayListings - too soon since last fetch'
        );
        setListingsLoading(false); // ALWAYS clear loading state
        return;
      }

      // Check if already loading
      if (listingsLoading && !force) {
        console.log('⏳ Listings already loading, skipping...');
        return;
      }

      try {
        setLastRefreshTime(now);
        setListingsLoading(true);
        setError(null);

        console.log('🔄 Fetching eBay listings...');
        const response = await apiService.inventory.getActiveListings();

        console.log('📦 API Response received:', response);

        // CRITICAL FIX: Always clear loading state regardless of component mount state
        const clearLoadingState = () => {
          setListingsLoading(false);
        };

        if (response.success) {
          // Check for eBay API errors in the response data
          if (response.data?.GetMyeBaySellingResponse?.Ack === 'Failure') {
            const ebayError = response.data.GetMyeBaySellingResponse.Errors;

            if (ebayError?.ErrorCode === '932') {
              console.warn('eBay token is hard expired');
              localStorage.removeItem('ebay_user_token');
              localStorage.removeItem('ebay_refresh_token');
              window.dispatchEvent(new CustomEvent('ebayTokenExpired'));
              setError(
                'eBay token expired. Please reconnect your eBay account.'
              );
              clearLoadingState(); // ALWAYS clear loading
              return;
            }

            setError(
              `eBay API Error: ${ebayError?.ShortMessage || 'Unknown error'}`
            );
            clearLoadingState(); // ALWAYS clear loading
            return;
          }

          let ebayListings = [];

          if (
            response.data &&
            response.data.GetMyeBaySellingResponse &&
            response.data.GetMyeBaySellingResponse.ActiveList &&
            response.data.GetMyeBaySellingResponse.ActiveList.ItemArray
          ) {
            const itemArray =
              response.data.GetMyeBaySellingResponse.ActiveList.ItemArray;
            if (Array.isArray(itemArray.Item)) {
              ebayListings = itemArray.Item;
            } else if (itemArray.Item) {
              ebayListings = [itemArray.Item];
            }
          }

          // CRITICAL FIX: Show basic listings first, then enhance with additional data
          if (ebayListings.length > 0) {
            console.log(
              `📦 Processing ${ebayListings.length} eBay listings...`
            );

            // STEP 1: Create basic listings and display immediately
            const basicListings = ebayListings.map((item) => ({
              productTitle: item.Title,
              productId: item.ItemID,
              sku: item.SKU || ' ',
              status: [
                item.SellingStatus?.ListingStatus || 'Active',
                item.ConditionDisplayName || 'New',
              ],
              price: `USD ${parseFloat(item.BuyItNowPrice || 0).toFixed(2)}`,
              qty: parseInt(item.Quantity || '0', 10),
              myPrice: `USD ${parseFloat(item.BuyItNowPrice || 0).toFixed(2)}`,
              competition: 'Loading...',
              strategy: 'Loading...',
              minPrice: 'Loading...',
              maxPrice: 'Loading...',
              hasStrategy: false,
              competitors: 0,
            }));

            // STEP 2: Display basic data immediately and clear loading
            if (mountedRef.current) {
              console.log(
                `✅ Displaying ${basicListings.length} basic listings immediately`
              );
              setRows(basicListings);
              modifyProductsArray(basicListings);
              clearLoadingState(); // Clear loading immediately after showing basic data
            }

            // STEP 3: Enhance with additional data in background (non-blocking)
            setTimeout(async () => {
              if (!mountedRef.current) return;

              console.log(
                '🔄 Enhancing listings with competitor and strategy data...'
              );

              const enhancedListings = await Promise.allSettled(
                basicListings.map(async (basicItem) => {
                  try {
                    const itemID = basicItem.productId;

                    // Get additional data with fallbacks
                    const [manualCompetitorsRes, strategyDisplayRes] =
                      await Promise.allSettled([
                        apiService.inventory.getManuallyAddedCompetitors(
                          itemID
                        ),
                        apiService.pricingStrategies.getStrategyDisplayForProduct(
                          itemID
                        ),
                      ]);

                    // Process competitor data - FIXED: Use count field from API
                    let competitorData = { count: 0, lowestPrice: 'None' };
                    if (
                      manualCompetitorsRes.status === 'fulfilled' &&
                      manualCompetitorsRes.value.success
                    ) {
                      const response = manualCompetitorsRes.value;

                      // Use count field from API if available, otherwise calculate from array
                      competitorData.count =
                        typeof response.count === 'number'
                          ? response.count
                          : (response.competitors || []).length;

                      const competitors = response.competitors || [];
                      if (competitors.length > 0) {
                        const prices = competitors
                          .map((comp) => parseFloat(comp.price))
                          .filter((price) => !isNaN(price));

                        if (prices.length > 0) {
                          const minPrice = Math.min(...prices);
                          competitorData.lowestPrice = `USD ${minPrice.toFixed(
                            2
                          )}`;
                        }
                      }
                    }

                    // Process strategy data
                    let strategyData = {
                      strategy: 'Assign Strategy',
                      minPrice: 'Set',
                      maxPrice: 'Set',
                      hasStrategy: false,
                    };
                    if (
                      strategyDisplayRes.status === 'fulfilled' &&
                      strategyDisplayRes.value.success
                    ) {
                      strategyData =
                        strategyDisplayRes.value.data || strategyData;
                    }

                    // Return enhanced item
                    return {
                      ...basicItem,
                      competition: competitorData.lowestPrice,
                      strategy: strategyData.strategy,
                      minPrice: strategyData.minPrice,
                      maxPrice: strategyData.maxPrice,
                      hasStrategy: strategyData.hasStrategy,
                      competitors: competitorData.count,
                    };
                  } catch (error) {
                    console.warn(
                      `⚠️ Error enhancing ${basicItem.productId}:`,
                      error.message
                    );
                    return basicItem; // Return basic data if enhancement fails
                  }
                })
              );

              // Update with enhanced data
              const validEnhancedListings = enhancedListings
                .filter((result) => result.status === 'fulfilled')
                .map((result) => result.value);

              if (mountedRef.current && validEnhancedListings.length > 0) {
                console.log(
                  `✅ Updated with enhanced data for ${validEnhancedListings.length} listings`
                );
                setRows(validEnhancedListings);
                modifyProductsArray(validEnhancedListings);

                // ADDED: Force a small re-render to ensure CompetitorCount components update
                setTimeout(() => {
                  if (mountedRef.current) {
                    setRows((prevRows) => [...prevRows]); // Trigger re-render
                  }
                }, 500);
              }
            }, 100); // Very short delay to ensure UI renders basic data first
          } else {
            console.warn('No active listings found');
            setError('No active listings found');
            clearLoadingState(); // ALWAYS clear loading
          }
        } else {
          console.error('API error:', response.error);
          setError('Failed to fetch eBay listings');
          clearLoadingState(); // ALWAYS clear loading
        }
      } catch (error) {
        console.error('Error fetching eBay data:', error);
        setError(error.message);
        setListingsLoading(false); // ALWAYS clear loading state on error
      }
    },
    [lastRefreshTime, listingsLoading, modifyProductsArray, user]
  );

  // CRITICAL: Lightning-fast initial fetch with immediate auth check
  useEffect(() => {
    mountedRef.current = true;

    console.log('📋 ListingsTable: ⚡ LIGHTNING initial load check...');

    // Immediate fetch if we have any auth indication
    const hasAuth = lightningAuthCheck();
    if (hasAuth || user) {
      console.log('📋 ListingsTable: ⚡ INSTANT fetch - auth detected');
      fetchEbayListings(true); // Force initial fetch immediately
    } else {
      console.log('📋 ListingsTable: ⏳ No immediate auth, waiting briefly...');
      // Wait very briefly for auth to load, then try anyway
      const authTimeout = setTimeout(() => {
        if (mountedRef.current) {
          console.log(
            '📋 ListingsTable: ⚡ Timeout reached, attempting fetch anyway'
          );
          fetchEbayListings(true);
        }
      }, 1000); // Reduced to 1 second

      return () => {
        clearTimeout(authTimeout);
        mountedRef.current = false;
      };
    }

    return () => {
      mountedRef.current = false;
    };
  }, []); // Only run once on mount

  // FIXED: AllProducts sync with proper dependency
  useEffect(() => {
    if (AllProducts && AllProducts.length > 0 && mountedRef.current) {
      setRows(AllProducts);
      setListingsLoading(false); // Ensure loading is cleared when we have data
    }
  }, [AllProducts]);

  // Search filtering effect
  useEffect(() => {
    if (!Array.isArray(AllProducts)) {
      setRows([]);
      return;
    }
    const searchP = searchProduct.toLowerCase();
    const filtered = AllProducts.filter(
      (row) =>
        row.productTitle?.toLowerCase().includes(searchP) ||
        row.sku?.toLowerCase().includes(searchP) ||
        row.status?.some((s) => s.toLowerCase().includes(searchP)) ||
        row.productId?.toLowerCase().includes(searchP)
    );
    setRows(filtered);
  }, [searchProduct, AllProducts]);

  // Pagination calculation
  useEffect(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginated = rows.slice(startIndex, endIndex);
    setPaginatedRows(paginated);

    const totalPages = Math.ceil(rows.length / itemsPerPage);
    if (onTotalPagesChange) {
      onTotalPagesChange(totalPages);
    }
  }, [rows, currentPage, itemsPerPage, onTotalPagesChange]);

  // Sorting logic
  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDirection('asc');
    }
  };

  // Sort and paginate effect
  useEffect(() => {
    let sortedRows = [...rows];
    if (sortBy) {
      sortedRows.sort((a, b) => {
        let aValue = a[sortBy];
        let bValue = b[sortBy];

        if (typeof aValue === 'string' && typeof bValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue.toLowerCase();
        }
        if (sortBy === 'qty') {
          aValue = Number(aValue);
          bValue = Number(bValue);
        }
        if (
          sortBy === 'myPrice' ||
          sortBy === 'price' ||
          sortBy === 'competition' ||
          sortBy === 'minPrice' ||
          sortBy === 'maxPrice'
        ) {
          aValue = parseFloat((aValue || '').replace(/[^\d.]/g, '')) || 0;
          bValue = parseFloat((bValue || '').replace(/[^\d.]/g, '')) || 0;
        }
        if (sortBy === 'competitors') {
          aValue = Number(aValue) || 0;
          bValue = Number(bValue) || 0;
        }
        if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    setPaginatedRows(sortedRows.slice(startIndex, endIndex));

    const totalPages = Math.ceil(sortedRows.length / itemsPerPage);
    if (onTotalPagesChange) {
      onTotalPagesChange(totalPages);
    }
  }, [
    rows,
    currentPage,
    itemsPerPage,
    onTotalPagesChange,
    sortBy,
    sortDirection,
  ]);

  if (listingsLoading) {
    return (
      <Container
        sx={{ mt: 4, mb: 2, display: 'flex', justifyContent: 'center', py: 5 }}
      >
        <CircularProgress />
        <Typography sx={{ ml: 2 }} color="textSecondary">
          Loading your listings...
        </Typography>
      </Container>
    );
  }

  if (error) {
    return (
      <Container sx={{ mt: 4, mb: 2 }}>
        <Typography color="error" variant="h6" textAlign="center">
          Error loading listings: {error}
        </Typography>
        <Typography textAlign="center" mt={2}>
          <Button variant="outlined" onClick={() => fetchEbayListings(true)}>
            Try Again
          </Button>
        </Typography>
      </Container>
    );
  }

  // Define headers based on mode
  const getHeaders = () => {
    const baseHeaders = [
      { label: 'Product', key: 'productTitle' },
      { label: 'Qty', key: 'qty' },
      { label: 'My Price', key: 'myPrice' },
    ];

    switch (mode) {
      case 'competitors':
        return [
          ...baseHeaders,
          { label: 'Competitors Rule', key: null },
          { label: 'Competition', key: 'competition' },
          { label: 'Competitors', key: 'competitors' },
        ];
      case 'strategies':
        return [
          ...baseHeaders,
          { label: 'Strategy', key: 'strategy' },
          { label: 'Min Price', key: 'minPrice' },
          { label: 'Max Price', key: 'maxPrice' },
        ];
      default:
        return [
          ...baseHeaders,
          { label: 'Competitors Rule', key: null },
          { label: 'Competition', key: 'competition' },
          { label: 'Strategy', key: 'strategy' },
          { label: 'Min Price', key: 'minPrice' },
          { label: 'Max Price', key: 'maxPrice' },
          { label: 'Competitors', key: 'competitors' },
        ];
    }
  };

  const headers = getHeaders();

  // Function to render table cells based on mode
  const renderTableCells = (row) => {
    const baseCells = [
      // Product Cell
      <TableCell
        key="product"
        sx={{
          border: '1px solid #ddd',
          padding: '10px',
          backgroundColor: '#fff',
        }}
      >
        <Box>
          <Link
            href={`https://www.ebay.com/itm/${row.productId}`}
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            color="primary"
            fontSize={16}
            sx={{ fontWeight: 600 }}
          >
            {row.productTitle}
          </Link>
          <Typography
            variant="caption"
            color="textSecondary"
            display="block"
            sx={{ fontSize: '14px' }}
          >
            {row.productId} |{' '}
            {row.status.map((s, i) => (
              <Typography
                key={i}
                component="span"
                sx={{
                  fontSize: '14px',
                  color: s === 'Active' ? '#1e852b' : 'gray',
                  mx: 0.5,
                }}
              >
                {s}
              </Typography>
            ))}
          </Typography>
        </Box>
      </TableCell>,

      // Qty Cell
      <TableCell
        key="qty"
        sx={{
          border: '1px solid #ddd',
          padding: '16px',
          backgroundColor: '#fff',
        }}
      >
        {row.qty}
      </TableCell>,

      // My Price Cell
      <TableCell
        key="price"
        sx={{
          border: '1px solid #ddd',
          padding: '16px',
          backgroundColor: '#fff',
        }}
      >
        {row.myPrice}
      </TableCell>,
    ];

    switch (mode) {
      case 'competitors':
        return [
          ...baseCells,
          // Competitors Rule Cell
          <TableCell
            key="compRule"
            sx={{
              border: '1px solid #ddd',
              padding: '16px',
              backgroundColor: '#fff',
            }}
          >
            <Typography
              color="primary"
              sx={{
                cursor: 'pointer',
                textDecoration: 'underline',
                fontSize: '16px',
              }}
              onClick={() => {
                modifyProductsId(row.productId);
                navigate(`/price-strategy/${row.productId}`);
              }}
            >
              Assign Rule
            </Typography>
          </TableCell>,
          // Competition Cell
          <TableCell
            key="competition"
            sx={{
              border: '1px solid #ddd',
              padding: '16px',
              backgroundColor: '#fff',
            }}
          >
            {row.competition}
          </TableCell>,
          // Competitors Cell
          <TableCell
            key="competitors"
            sx={{
              border: '1px solid #ddd',
              padding: '16px',
              backgroundColor: '#fff',
            }}
          >
            <Typography
              color="primary"
              sx={{
                cursor: 'pointer',
                textDecoration: 'underline',
                fontSize: '16px',
              }}
              onClick={() => {
                modifyProductsObj(row);
                navigate(`/competitor-details/${row.productId}`);
              }}
            >
              <CompetitorCount itemId={row.productId} />
            </Typography>
          </TableCell>,
        ];

      case 'strategies':
        return [
          ...baseCells,
          // Strategy Cell
          <TableCell
            key="strategy"
            sx={{
              border: '1px solid #ddd',
              padding: '16px',
              backgroundColor: '#fff',
            }}
          >
            <Typography
              color="primary"
              sx={{
                cursor: 'pointer',
                fontSize: '16px',
                '&:hover': {
                  textDecoration: 'underline',
                },
              }}
              onClick={() => {
                console.log(
                  `🔀 Navigating to strategy form for product: ${row.productId}`
                );
                modifyProductsId(row.productId);
                navigate(`/price-strategy/${row.productId}`);
              }}
            >
              {row.strategy}
            </Typography>
          </TableCell>,
          // Min Price Cell
          <TableCell
            key="minPrice"
            sx={{
              border: '1px solid #ddd',
              padding: '16px',
              backgroundColor: '#fff',
            }}
          >
            <Typography
              color="primary"
              sx={{
                cursor: 'pointer',
                fontSize: '16px',
                '&:hover': {
                  textDecoration: 'underline',
                },
              }}
              onClick={() => {
                console.log(
                  `🔀 Navigating to strategy form for min price: ${row.productId}`
                );
                modifyProductsId(row.productId);
                navigate(`/price-strategy/${row.productId}`);
              }}
            >
              {row.minPrice}
            </Typography>
          </TableCell>,
          // Max Price Cell
          <TableCell
            key="maxPrice"
            sx={{
              border: '1px solid #ddd',
              padding: '16px',
              backgroundColor: '#fff',
            }}
          >
            <Typography
              color="primary"
              sx={{
                cursor: 'pointer',
                fontSize: '16px',
                '&:hover': {
                  textDecoration: 'underline',
                },
              }}
              onClick={() => {
                console.log(
                  `🔀 Navigating to strategy form for max price: ${row.productId}`
                );
                modifyProductsId(row.productId);
                navigate(`/price-strategy/${row.productId}`);
              }}
            >
              {row.maxPrice}
            </Typography>
          </TableCell>,
        ];

      default: // 'listings' - show all columns
        return [
          ...baseCells,
          // Competitors Rule Cell
          <TableCell
            key="compRule"
            sx={{
              border: '1px solid #ddd',
              padding: '16px',
              backgroundColor: '#fff',
            }}
          >
            <Typography
              color="primary"
              sx={{
                cursor: 'pointer',
                textDecoration: 'underline',
                fontSize: '16px',
              }}
              onClick={() => {
                console.log(
                  `🔀 Navigating to strategy form via Assign Rule: ${row.productId}`
                );
                modifyProductsId(row.productId);
                modifySku(row.sku ? row.sku : '');
                navigate(`/home/update-strategy/${row.productId}`);
              }}
            >
              Assign Rule
            </Typography>
          </TableCell>,
          // Competition Cell
          <TableCell
            key="competition"
            sx={{
              border: '1px solid #ddd',
              padding: '16px',
              backgroundColor: '#fff',
            }}
          >
            {row.competition}
          </TableCell>,
          // Strategy Cell
          <TableCell
            key="strategy"
            sx={{
              border: '1px solid #ddd',
              padding: '16px',
              backgroundColor: '#fff',
            }}
          >
            <Typography
              color="primary"
              sx={{
                cursor: 'pointer',
                fontSize: '16px',
                '&:hover': {
                  textDecoration: 'underline',
                },
              }}
              onClick={() => {
                console.log(
                  `🔀 Navigating to strategy form for product: ${row.productId}`
                );
                modifyProductsId(row.productId);
                navigate(`/price-strategy/${row.productId}`);
              }}
            >
              {row.strategy}
            </Typography>
          </TableCell>,
          // Min Price Cell
          <TableCell
            key="minPrice"
            sx={{
              border: '1px solid #ddd',
              padding: '16px',
              backgroundColor: '#fff',
            }}
          >
            <Typography
              color="primary"
              sx={{
                cursor: 'pointer',
                fontSize: '16px',
                '&:hover': {
                  textDecoration: 'underline',
                },
              }}
              onClick={() => {
                console.log(
                  `🔀 Navigating to strategy form for min price: ${row.productId}`
                );
                modifyProductsId(row.productId);
                navigate(`/price-strategy/${row.productId}`);
              }}
            >
              {row.minPrice}
            </Typography>
          </TableCell>,
          // Max Price Cell
          <TableCell
            key="maxPrice"
            sx={{
              border: '1px solid #ddd',
              padding: '16px',
              backgroundColor: '#fff',
            }}
          >
            <Typography
              color="primary"
              sx={{
                cursor: 'pointer',
                fontSize: '16px',
                '&:hover': {
                  textDecoration: 'underline',
                },
              }}
              onClick={() => {
                console.log(
                  `🔀 Navigating to strategy form for max price: ${row.productId}`
                );
                modifyProductsId(row.productId);
                navigate(`/price-strategy/${row.productId}`);
              }}
            >
              {row.maxPrice}
            </Typography>
          </TableCell>,
          // Competitors Cell
          <TableCell
            key="competitors"
            sx={{
              border: '1px solid #ddd',
              padding: '16px',
              backgroundColor: '#fff',
            }}
          >
            <Typography
              color="primary"
              sx={{
                cursor: 'pointer',
                textDecoration: 'underline',
                fontSize: '16px',
              }}
              onClick={() => {
                console.log(
                  `🔀 Navigating to competitor details for product: ${row.productId}`
                );
                modifyProductsObj(row);
                navigate(`/competitor-details/${row.productId}`);
              }}
            >
              <CompetitorCount itemId={row.productId} />
            </Typography>
          </TableCell>,
        ];
    }
  };

  return (
    <Container sx={{ mt: 4, mb: 2, pb: 10 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
        }}
      >
        <Typography variant="h5" component="h1">
          {mode === 'competitors'
            ? 'Competitor Management'
            : mode === 'strategies'
            ? 'Pricing Strategy Management'
            : 'Active Listings - Strategy Managed'}
        </Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => fetchEbayListings(true)}
          disabled={listingsLoading}
          sx={{ ml: 2 }}
        >
          {listingsLoading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Box>

      {/* Show row count when data is available */}
      {rows.length > 0 && (
        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
          Showing {paginatedRows.length} of {rows.length} listings
        </Typography>
      )}

      <TableContainer
        component={Paper}
        sx={{ borderRadius: 2, border: '1px solid #ddd' }}
      >
        <Table sx={{ minWidth: 650 }}>
          <TableHead>
            <TableRow
              sx={{
                backgroundColor: '#ffffff',
                borderBottom: '2px solid #e0e0e0',
                boxShadow: '0px 4px 10px rgba(0, 0, 0, 0.1)',
                '&:hover': {
                  backgroundColor: '#f9f9f9',
                },
                transition: 'background-color 0.3s ease',
              }}
            >
              {headers.map((header) => (
                <TableCell
                  key={header.label}
                  sx={{
                    fontWeight: '600',
                    fontSize: '15px',
                    padding: '8px',
                    borderRight: '1px solid #ddd',
                    color: '#333',
                    backgroundColor: '#fafafa',
                    textAlign: 'left',
                    '&:last-child': {
                      borderRight: 'none',
                    },
                    '&:hover': {
                      backgroundColor: '#f5f5f5',
                      color: '#1976d2',
                    },
                    transition: 'all 0.3s ease',
                    cursor: header.key ? 'pointer' : 'default',
                    userSelect: 'none',
                  }}
                  onClick={
                    header.key ? () => handleSort(header.key) : undefined
                  }
                >
                  {header.label}
                  {header.key && sortBy === header.key && (
                    <span style={{ marginLeft: 4 }}>
                      {sortDirection === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedRows.length > 0 ? (
              paginatedRows.map((row, idx) => (
                <TableRow
                  key={row.productId || idx}
                  sx={{
                    '&:hover': {
                      backgroundColor: '#f5f5f5',
                      boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.1)',
                      cursor: 'pointer',
                    },
                    transition: 'all 0.3s ease',
                  }}
                >
                  {renderTableCells(row)}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={headers.length}
                  sx={{
                    textAlign: 'center',
                    py: 4,
                    color: 'text.secondary',
                  }}
                >
                  {listingsLoading
                    ? 'Loading listings...'
                    : 'No listings found'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Container>
  );
}
