import React, { useState, useEffect } from "react";
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
  CircularProgress,
  Grid,
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useProductStore } from "../store/productStore";
import { useNavigate } from "react-router-dom";
import apiService from "../api/apiService";

export default function AddStrategyForm() {
  const [assignToAll, setAssignToAll] = useState(false);
  const { ItemId, AllProducts, modifyProductsObj, sku } = useProductStore();
  const [product, setProduct] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [oldPrice, setOldPrice] = useState(0);
  const navigate = useNavigate();

  // State for selected strategy
  const [strategy, setStrategy] = useState("");

  // Effect to fetch product data
  useEffect(() => {
    const fetchProductData = async () => {
      try {
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
          // Handle different price formats (with or without currency symbol)
          const priceValue = priceString.includes(" ")
            ? priceString.split(" ")[1]
            : priceString.replace(/[^0-9.]/g, "");

          setOldPrice(priceValue);

          // Initialize form values with product price
          setFormValues((prev) => ({
            ...prev,
            landedPrice: priceValue,
            minPrice: (parseFloat(priceValue) * 0.9).toFixed(2), // 10% below landed price
            maxPrice: (parseFloat(priceValue) * 1.5).toFixed(2), // 50% above landed price
            targetPrice: priceValue,
          }));
        }
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

  // State for form values
  const [formValues, setFormValues] = useState({
    itemId: ItemId,
    competitorRule: "",
    landedPrice: "",
    lowestPrice: "",
    minPrice: "",
    maxPrice: "",
    targetPrice: "",
    basePrice: "",
    weekendBoost: "1.1",
    holidayBoost: "1.25",
    clearanceThreshold: "30",
    repriceFrequency: "daily",
    competitorAdjustment: "0",
    enableBestOffer: false,
    bestOfferAutoAccept: "",
    bestOfferAutoDecline: "",
    demandMultiplier: "1.2",
    inventoryThreshold: "10",
    notes: "",
  });

  // State for alert
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [alertSeverity, setAlertSeverity] = useState("info");

  // Handle strategy change
  const handleStrategyChange = (event) => {
    const selectedStrategy = event.target.value;
    setStrategy(selectedStrategy);

    // Set default values based on strategy
    if (selectedStrategy === "Fixed") {
      setFormValues((prev) => ({
        ...prev,
        targetPrice: oldPrice || prev.landedPrice,
      }));
    } else if (selectedStrategy === "Time Based") {
      setFormValues((prev) => ({
        ...prev,
        basePrice: oldPrice || prev.landedPrice,
      }));
    } else if (selectedStrategy === "Dynamic") {
      // Set default values for Dynamic strategy
      setFormValues((prev) => ({
        ...prev,
        minPrice: prev.minPrice || (parseFloat(oldPrice) * 0.9).toFixed(2),
        maxPrice: prev.maxPrice || (parseFloat(oldPrice) * 1.5).toFixed(2),
        demandMultiplier: "1.2",
        inventoryThreshold: "10",
      }));
    }
  };

  // Handle form value changes
  const handleFormChange = (event) => {
    const { name, value, checked, type } = event.target;
    let processedValue = value;

    // For number inputs, ensure we handle empty strings properly
    if (type === "number" && value === "") {
      processedValue = "";
    } else if (type === "number") {
      // For other number values, store them as strings but validate as numbers
      processedValue = value;
    }

    setFormValues((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : processedValue,
    }));
  };

  // Handle form submission
  const handleSubmit = async (event) => {
    event.preventDefault();

    // Validate form based on selected strategy
    if (!strategy) {
      showAlert("Please select a pricing strategy", "error");
      return;
    }

    if (strategy === "Fixed" && !formValues.targetPrice) {
      showAlert("Target price is required for Fixed strategy", "error");
      return;
    }

    if (
      (strategy === "Competitive" || strategy === "Dynamic") &&
      (!formValues.minPrice || !formValues.maxPrice)
    ) {
      showAlert("Min and max prices are required", "error");
      return;
    }

    if (strategy === "Time Based" && !formValues.basePrice) {
      showAlert("Base price is required for Time Based strategy", "error");
      return;
    }

    // Check min price is less than max price
    if (
      (strategy === "Competitive" || strategy === "Dynamic") &&
      parseFloat(formValues.minPrice) >= parseFloat(formValues.maxPrice)
    ) {
      showAlert("Min price must be less than max price", "error");
      return;
    }

    // Prepare payload based on strategy
    let payload = {
      itemId: formValues.itemId,
      strategy: strategy.toLowerCase().replace(" ", "-"),
    };

    switch (strategy) {
      case "Fixed":
        payload = {
          ...payload,
          targetPrice: formValues.targetPrice,
          enableBestOffer: formValues.enableBestOffer,
          ...(formValues.enableBestOffer &&
            formValues.bestOfferAutoAccept && {
              bestOfferAutoAccept: formValues.bestOfferAutoAccept,
            }),
          ...(formValues.enableBestOffer &&
            formValues.bestOfferAutoDecline && {
              bestOfferAutoDecline: formValues.bestOfferAutoDecline,
            }),
        };
        break;

      case "Competitive":
        payload = {
          ...payload,
          minPrice: formValues.minPrice,
          maxPrice: formValues.maxPrice,
          targetPrice: formValues.targetPrice || formValues.landedPrice,
          repriceFrequency: formValues.repriceFrequency,
          competitorAdjustment: formValues.competitorAdjustment,
        };
        break;

      case "Dynamic":
        payload = {
          ...payload,
          minPrice: formValues.minPrice,
          maxPrice: formValues.maxPrice,
          competitorAdjustment: formValues.competitorAdjustment,
          demandMultiplier: formValues.demandMultiplier,
          inventoryThreshold: formValues.inventoryThreshold,
        };
        break;

      case "Time Based":
        payload = {
          ...payload,
          basePrice: formValues.basePrice,
          weekendBoost: formValues.weekendBoost,
          holidayBoost: formValues.holidayBoost,
          clearanceThreshold: formValues.clearanceThreshold,
        };
        break;
    }

    // Add notes if provided
    if (formValues.notes) {
      payload.notes = formValues.notes;
    }

    // Submit the payload
    console.log("Submitting pricing strategy:", payload);

    try {
      setSubmitting(true);
      const response = await apiService.inventory.assignPricingStrategy(
        payload
      );
      console.log("API response:", response);
      showAlert("Pricing strategy updated successfully!", "success");

      // Optional: Navigate after success with slight delay

      // setTimeout(() => {
      //   navigate("/inventory");
      // }, 2000);
    } catch (error) {
      console.error("Error setting pricing strategy:", error);
      setError(error.message);
      showAlert(`Error: ${error.message || "Something went wrong"}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  // Show alert
  const showAlert = (message, severity) => {
    setAlertMessage(message);
    setAlertSeverity(severity);
    setAlertOpen(true);

    // Auto-close successful alerts after 5 seconds
    if (severity === "success") {
      setTimeout(() => {
        setAlertOpen(false);
      }, 5000);
    }
  };

  if (loading) {
    return (
      <Container>
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "50vh",
          }}
        >
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
    <>
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
            Assign Pricing Strategy
          </Typography>

          {/* Product Info */}
          <Box mb={3} sx={{ textAlign: "center" }}>
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
          <Box
            component="form"
            display="flex"
            flexDirection="column"
            gap={3}
            onSubmit={handleSubmit}
          >
            {/* Pricing Strategy */}
            <TextField
              select
              label="Strategy Name"
              value={strategy}
              name="strategy"
              onChange={handleStrategyChange}
              required
              sx={{
                "& .MuiInputLabel-root": { fontSize: "16px" },
                "& .MuiInputBase-root": { fontSize: "16px" },
              }}
            >
              <MenuItem value="">Select a strategy</MenuItem>
              <MenuItem value="Fixed">Fixed</MenuItem>
              <MenuItem value="Competitive">Competitive</MenuItem>
              <MenuItem value="Dynamic">Dynamic</MenuItem>
              <MenuItem value="Time Based">Time Based</MenuItem>
            </TextField>

            <TextField
              select
              label="Repricing Rule"
              value={strategy}
              name="strategy"
              onChange={handleStrategyChange}
              required
              sx={{
                "& .MuiInputLabel-root": { fontSize: "16px" },
                "& .MuiInputBase-root": { fontSize: "16px" },
              }}
            >
              <MenuItem value="">Select a rule</MenuItem>
              <MenuItem value="Fixed">---------------</MenuItem>
              {/* <MenuItem value="Competitive">Competitive</MenuItem>
              <MenuItem value="Dynamic">Dynamic</MenuItem>
              <MenuItem value="Time Based">Time Based</MenuItem> */}
            </TextField>

            <Typography
              variant="h6"
              fontWeight="bold"
              mb={3}
              sx={{ textAlign: "left", color: "#333" }}
            >
              Advanced Options
            </Typography>
            {/* Label + Dropdown aligned horizontally */}
            <Grid container alignItems="center" spacing={2}>
              <Grid item xs={4}>
                <Typography> If there is no competition </Typography>
              </Grid>
              {/* <Grid item xs={8}> */}
              <TextField
                select
                value={"Use Max Price"}
                name="strategy"
                onChange={handleStrategyChange}
                fullWidth
                sx={{
                  "& .MuiInputBase-root": { fontSize: "14px" },
                  "& .MuiInputLabel-root": { fontSize: "14px" },
                }}
              >
                <MenuItem value="Use Max Price">Select a rule</MenuItem>
                <MenuItem value="UseMaxPrice">Use Max Price</MenuItem>
                <MenuItem value="UseMinPrice">Use Min Price</MenuItem>
                <MenuItem value="DoNothing">Do Nothing</MenuItem>
              </TextField>
              {/* </Grid> */}
            </Grid>

            {/* Checkbox below */}
            <Box mt={2}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={assignToAll}
                    // onChange={handleAssignToAllChange}
                    name="assignToAll"
                  />
                }
                label="Assign this strategy now to all my active listings."
              />
            </Box>

            <Button
              variant="contained"
              color="primary"
              sx={{
                padding: "12px 20px",
                width: "120px", // 👈 Updated width
                fontWeight: 600,
                fontSize: "16px",
                borderRadius: "25px",
                "&:hover": {
                  backgroundColor: "#1976d2",
                  boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.1)",
                },
                transition: "all 0.3s ease-in-out",
              }}
              onClick={() => {
                handlEditPrice();
                handleOpen();
              }}
            >
              Add
            </Button>
          </Box>
        </Box>
      </Container>
    </>
  );
}
