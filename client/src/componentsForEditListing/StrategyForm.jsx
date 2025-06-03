import React, { useState, useEffect } from 'react';
import { 
  Container, 
  Box, 
  Typography, 
  TextField, 
  MenuItem, 
  Button,
  Alert,
  Collapse,
  IconButton,
  CircularProgress
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useProductStore } from '../store/productStore';
import { useNavigate } from 'react-router-dom';
import apiService from '../api/apiService';

export default function EditStrategy() {
  const { ItemId, AllProducts, modifyProductsObj, sku} = useProductStore();
  const [product, setProduct] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [oldPrice, setOldPrice] = useState(0);
  const navigate = useNavigate();

  // Form state
  const [formData, setFormData] = useState({
    selectedStrategy: '',
    selectedCompetitorRule: '',
    myLandedPrice: '',
    lowestPrice: '',
    minPrice: '',
    maxPrice: '',
    notes: ''
  });

  // Available strategies and rules (fetched from APIs)
  const [availableStrategies, setAvailableStrategies] = useState([]);
  const [availableRules, setAvailableRules] = useState([]);

  // Alert state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [alertSeverity, setAlertSeverity] = useState('info');

  // Fetch product data
  useEffect(() => {
    const fetchProductData = async () => {
      try {
        console.log("product data fetching ", sku) 
        setLoading(true); 
        const productObj = AllProducts.filter((item) =>
          item.sku ? item.sku === sku : item.productId === ItemId
        );
        
        if (productObj.length === 0) {
          setError("Product not found");
          return;
        }
        
        setProduct(productObj);
        modifyProductsObj(productObj);
        
        // Set oldPrice from product data
        if (productObj[0]?.myPrice) {
          const priceString = productObj[0].myPrice;
          const priceValue = priceString.includes(" ") 
            ? priceString.split(" ")[1] 
            : priceString.replace(/[^0-9.]/g, '');
          
          setOldPrice(priceValue);
          
          // Initialize form values with product price
          setFormData(prev => ({
            ...prev,
            myLandedPrice: priceValue,
            minPrice: (parseFloat(priceValue) * 0.9).toFixed(2), // 10% below
            maxPrice: (parseFloat(priceValue) * 1.5).toFixed(2), // 50% above
          }));
        }

        // Fetch existing strategies and rules for this product
        await fetchExistingData();
        
      } catch (err) {
        setError("Error loading product data: " + err.message);
        console.error("Error loading product:", err);
      } finally {
        setLoading(false);
      }
    };

    if (ItemId) {
      fetchProductData();
    }
  }, [ItemId, AllProducts, modifyProductsObj]);

  // Fetch existing strategies and competitor rules
  const fetchExistingData = async () => {
    try {
        const strategyResponse = await apiService.pricingStrategies.getStrategyFromProduct(ItemId);
    console.log("strategyResponse", strategyResponse);
    
    if (strategyResponse.hasPricingStrategy) {
      // Keep the original structure but also add a normalized property for comparison
      const strategyWithNormalizedName = {
        ...strategyResponse.pricingStrategy,
        // Add this property for internal use without changing the original structure
        _normalizedName: strategyResponse.pricingStrategy.PricingStrategy || strategyResponse.pricingStrategy.strategyName || ""
      };
      
      setAvailableStrategies([strategyWithNormalizedName]);
      setFormData(prev => ({
        ...prev,
        selectedStrategy: strategyWithNormalizedName._normalizedName
      }));
    }
      // Fetch competitor rules for this product
      const ruleResponse = await apiService.competitorRules.getRuleFromProduct(ItemId);
      console.log("ruleResponse", ruleResponse)
      if (ruleResponse.hasCompetitorRule) {
        setAvailableRules([ruleResponse.competitorRule]);
        setFormData(prev => ({
          ...prev,
          selectedCompetitorRule: ruleResponse.competitorRule.ruleName
        }));
      }

      // If no existing data, fetch from active listings to show available options
      if (!strategyResponse.hasPricingStrategy) {
        const allStrategiesResponse = await apiService.pricingStrategies.getAllActiveWithStrategies();
        const uniqueStrategies = [];
        const seen = new Set();
        
        allStrategiesResponse.listings.forEach(listing => {
          if (listing.hasPricingStrategy && !seen.has(listing.pricingStrategy.strategyName)) {
            seen.add(listing.pricingStrategy.strategyName);
            uniqueStrategies.push(listing.pricingStrategy);
          }
        });
        
        setAvailableStrategies(uniqueStrategies);
      }

      if (!ruleResponse.hasCompetitorRule) {
        const allRulesResponse = await apiService.competitorRules.getAllActiveWithRules();
        const uniqueRules = [];
        const seen = new Set();
        
        allRulesResponse.listings.forEach(listing => {
          if (listing.hasCompetitorRule && !seen.has(listing.competitorRule.ruleName)) {
            seen.add(listing.competitorRule.ruleName);
            uniqueRules.push(listing.competitorRule);
          }
        });
        
        setAvailableRules(uniqueRules);
      }

    } catch (error) {
      console.error("Error fetching existing data:", error);
    }
  };

  // Handle input changes
  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Show alert
  const showAlert = (message, severity) => {
    setAlertMessage(message);
    setAlertSeverity(severity);
    setAlertOpen(true);
    
    if (severity === 'success') {
      setTimeout(() => {
        setAlertOpen(false);
      }, 5000);
    }
  };

  // Handle Update button click
  const handleUpdate = async () => {
    try {
      setSubmitting(true);

      // Validate required fields
      if (!formData.selectedStrategy) {
        showAlert("Please select a pricing strategy", "error");
        return;
      }

      if (!formData.minPrice || !formData.maxPrice) {
        showAlert("Min price and max price are required", "error");
        return;
      }

      if (parseFloat(formData.minPrice) >= parseFloat(formData.maxPrice)) {
        showAlert("Min price must be less than max price", "error");
        return;
      }

      // Find the selected strategy details
      const selectedStrategyObj = availableStrategies.find(s => 
        s.strategyName === formData.selectedStrategy
      );

      if (!selectedStrategyObj) {
        showAlert("Selected strategy not found", "error");
        return;
      }

      // Prepare update payload with new min/max prices
      const updatePayload = {
        ...selectedStrategyObj,
        minPrice: parseFloat(formData.minPrice),
        maxPrice: parseFloat(formData.maxPrice),
        notes: formData.notes
      };

      console.log("Updating strategy with payload:", updatePayload);

      // Update the strategy
      const response = await apiService.pricingStrategies.updateStrategyOnProduct(ItemId, updatePayload);
      
      console.log("Update response:", response);
      showAlert("Pricing strategy updated successfully!", "success");

      // Refresh the data
      await fetchExistingData();

    } catch (error) {
      console.error("Error updating strategy:", error);
      showAlert(`Error: ${error.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Container>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (error && !product.length) {
    return (
      <Container>
        <Box sx={{ p: 4 }}>
          <Alert severity="error">
            {error}
            <Button 
              variant="outlined" 
              size="small" 
              sx={{ ml: 2 }}
              onClick={() => navigate("/inventory")}
            >
              Back to Inventory
            </Button>
          </Alert>
        </Box>
      </Container>
    );
  }

  return (
    <Container>
      <Box sx={{ px: 4, py: 5, width: "100%", maxWidth: 700 }}>
        {/* Alert */}
        <Collapse in={alertOpen}>
          <Alert
            severity={alertSeverity}
            action={
              <IconButton
                aria-label="close"
                color="inherit"
                size="small"
                onClick={() => setAlertOpen(false)}
              >
                <CloseIcon fontSize="inherit" />
              </IconButton>
            }
            sx={{ mb: 2 }}
          >
            {alertMessage}
          </Alert>
        </Collapse>

        {/* Title */}
        <Typography
          variant="h5"
          fontWeight="bold"
          mb={3}
          sx={{ textAlign: "left", color: "#333" }}
        >
          Pricing Configuration
        </Typography>

        {/* Product Info */}
        <Box mb={3}>
          <Typography
            variant="body1"
            color="primary"
            fontWeight={600}
            sx={{ textAlign: "left", fontSize: "15px" }}
          >
            {product[0]?.productTitle || "Product"}
            <br />
            <Typography variant="caption" color="text.secondary">
              {product[0]?.productId || ItemId} |{" "}
              <span style={{ color: "#2E865F" }}>Active</span>
            </Typography>
          </Typography>
        </Box>

        {/* Current Price Display */}
        <Box mb={3} sx={{ textAlign: "left" }}>
          <Typography variant="body2" color="text.secondary">
            Current Price: <strong>${oldPrice}</strong>
          </Typography>
        </Box>

        {/* Form */}
        <Box display="flex" flexDirection="column" gap={3}>
          
         <TextField
  select
  label="Pricing Strategy"
  name="selectedStrategy"
  value={formData.selectedStrategy || ""}
  onChange={handleInputChange}
  sx={{
    "& .MuiInputLabel-root": { fontSize: "16px" },
    "& .MuiInputBase-root": { fontSize: "16px" },
  }}
>
  <MenuItem value="">Select a strategy</MenuItem>
  {availableStrategies.map((strategy) => {
    // Determine which property to use for display and value
    const displayName = strategy.strategyName || strategy.PricingStrategy || "";
    const valueToUse = strategy._normalizedName || displayName;
    
    return (
      <MenuItem 
        key={valueToUse} 
        value={valueToUse}
      >
        {displayName} ({strategy.repricingRule})
      </MenuItem>
    );
  })}
</TextField>

          <Typography
            variant="body2"
            sx={{
              color: "#1976d2",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              fontSize: "16px",
            }}
            onClick={() => navigate("/home/add-strategy")}
          >
            <Box
              component="span"
              sx={{ fontWeight: "bold", mr: 0.5, fontSize: "20px" }}
            >
              +
            </Box>{" "}
            Add Strategy
          </Typography>

          {/* Competitor Rule Section */}
          <TextField
            select
            label="Competitor Rule"
            name="selectedCompetitorRule"
            value={formData.selectedCompetitorRule}
            onChange={handleInputChange}
            sx={{
              "& .MuiInputLabel-root": { fontSize: "16px" },
              "& .MuiInputBase-root": { fontSize: "16px" },
            }}
          >
            <MenuItem value="">Select a rule</MenuItem>
            {availableRules.map((rule) => (
              <MenuItem key={rule.ruleName} value={rule.ruleName}>
                {rule.ruleName}
              </MenuItem>
            ))}
          </TextField>

          <Typography
            variant="body2"
            sx={{
              color: "#1976d2",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              fontSize: "16px",
            }}
            onClick={() => navigate("/home/add-competitor-rule")}
          >
            <Box
              component="span"
              sx={{ fontWeight: "bold", mr: 0.5, fontSize: "20px" }}
            >
              +
            </Box>{" "}
            Add Competitor Rule
          </Typography>

          {/* Price Fields */}
          <TextField
            label="My Landed Price"
            name="myLandedPrice"
            value={formData.myLandedPrice}
            onChange={handleInputChange}
            type="number"
            inputProps={{ step: "0.01", min: "0" }}
            sx={{
              "& .MuiInputLabel-root": { fontSize: "16px" },
              "& .MuiInputBase-root": { fontSize: "16px" },
              backgroundColor: "#f5f5f5"
            }}
          />

          <TextField
            label="Lowest Price"
            name="lowestPrice"
            value={formData.lowestPrice}
            onChange={handleInputChange}
            type="number"
            inputProps={{ step: "0.01", min: "0" }}
            sx={{
              "& .MuiInputLabel-root": { fontSize: "16px" },
              "& .MuiInputBase-root": { fontSize: "16px" },
              backgroundColor: "#f5f5f5"
            }}
          />

          <TextField
            label="Min Price (Landed)"
            name="minPrice"
            value={formData.minPrice}
            onChange={handleInputChange}
            required
            type="number"
            inputProps={{ step: "0.01", min: "0" }}
            sx={{
              "& .MuiInputLabel-root": { fontSize: "16px" },
              "& .MuiInputBase-root": { fontSize: "16px" },
            }}
          />

          <TextField
            label="Max Price (Landed)"
            name="maxPrice"
            value={formData.maxPrice}
            onChange={handleInputChange}
            required
            type="number"
            inputProps={{ step: "0.01", min: "0" }}
            sx={{
              "& .MuiInputLabel-root": { fontSize: "16px" },
              "& .MuiInputBase-root": { fontSize: "16px" },
            }}
          />

          <TextField
            label="Notes"
            name="notes"
            value={formData.notes}
            onChange={handleInputChange}
            placeholder="e.g. Entire inventory expiring in January."
            multiline
            rows={3}
            sx={{
              "& .MuiInputLabel-root": { fontSize: "16px" },
              "& .MuiInputBase-root": { fontSize: "16px" },
            }}
          />
          
          {/* Update Button */}
          <Button
            variant="contained"
            color="primary"
            onClick={handleUpdate}
            disabled={submitting}
            sx={{
              padding: "12px 20px",
              width: "120px",
              fontWeight: 600,
              fontSize: "16px",
              borderRadius: "25px",
              "&:hover": {
                backgroundColor: "#1976d2",
                boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.1)",
              },
              transition: "all 0.3s ease-in-out",
            }}
          >
            {submitting ? <CircularProgress size={24} color="inherit" /> : "Update"}
          </Button>
        </Box>
      </Box>
    </Container>
  );
}