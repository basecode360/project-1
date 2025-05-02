import React from "react";
import {
  Box,
  Typography,
  TextField,
  MenuItem,
  Button,
  Container,
} from "@mui/material";

export default function EditListing() {
  return (
    <>
      <Container>
        <Box sx={{ px: 4, py: 5, width: "100%", maxWidth: 700 }}>
          {/* Title */}
          <Typography
            variant="h5"
            fontWeight="bold"
            mb={3}
            sx={{ textAlign: "left", color: "#333" }}
          >
            Edit Listing
          </Typography>

          {/* Product Info */}
          <Box mb={3} sx={{ textAlign: "center" }}>
            <Typography
              variant="body1"
              color="primary"
              fontWeight={600}
              sx={{ textAlign: "left", fontSize: "15px" }}
            >
              Front Bumper Chrome + Valance + End Caps For 2007-10 Chevy
              Silverado 2500HD <br />
              <Typography
                variant="caption"
                color="text.secondary"
              >
                186801798810 | New (1) |{" "}
                <span style={{ color: "#2E865F" }}>Active</span>
              </Typography>
            </Typography>
          </Box>

          {/* Form */}
          <Box component="form" display="flex" flexDirection="column" gap={3}>
            {/* Pricing Strategy */}
            <TextField
              select
              label="Pricing Strategy"
              defaultValue="0.04"
              sx={{
                "& .MuiInputLabel-root": { fontSize: "16px" },
                "& .MuiInputBase-root": { fontSize: "16px" },
              }}
            >
              <MenuItem value="0.01">0.01</MenuItem>
              <MenuItem value="0.04">0.04</MenuItem>
            </TextField>

            {/* Competitor Rule */}
            <TextField
              select
              label="Competitor Rule"
              defaultValue=""
              sx={{
                "& .MuiInputLabel-root": { fontSize: "16px" },
                "& .MuiInputBase-root": { fontSize: "16px" },
              }}
            >
              <MenuItem value="">--------</MenuItem>
            </TextField>

            {/* Landed Price */}
            <TextField
              label="My Landed Price"
              defaultValue="414.73"
              disabled
              sx={{
                "& .MuiInputLabel-root": { fontSize: "16px" },
                "& .MuiInputBase-root": { fontSize: "16px" },
              }}
            />

            {/* Lowest Price */}
            <TextField
              label="Lowest Price"
              defaultValue="414.77"
              disabled
              sx={{
                "& .MuiInputLabel-root": { fontSize: "16px" },
                "& .MuiInputBase-root": { fontSize: "16px" },
              }}
            />

            {/* Min Price */}
            <TextField
              label="Min Price (Landed)"
              defaultValue="413.00"
              sx={{
                "& .MuiInputLabel-root": { fontSize: "16px" },
                "& .MuiInputBase-root": { fontSize: "16px" },
              }}
            />

            {/* Max Price */}
            <TextField
              label="Max Price (Landed)"
              defaultValue="600.00"
              sx={{
                "& .MuiInputLabel-root": { fontSize: "16px" },
                "& .MuiInputBase-root": { fontSize: "16px" },
              }}
            />

            {/* Notes */}
            <TextField
              label="Notes"
              multiline
              rows={3}
              placeholder="e.g. Entire inventory expiring in January."
              sx={{
                "& .MuiInputLabel-root": { fontSize: "16px" },
                "& .MuiInputBase-root": { fontSize: "16px" },
              }}
            />

            {/* Add Strategy Button */}
            <Box display="flex" justifyContent="flex-end" mb={3}>
              <Button
                variant="outlined"
                color="primary"
                sx={{
                  fontSize: "14px",
                  fontWeight: 600,
                  padding: "6px 16px",
                  textTransform: "none",
                  borderRadius: "20px",
                  "&:hover": {
                    backgroundColor: "#e0e0e0",
                    boxShadow: "0px 4px 8px rgba(0, 0, 0, 0.1)",
                  },
                }}
              >
                + Add Strategy
              </Button>
            </Box>

            {/* Update Button */}
            <Button
              variant="contained"
              color="primary"
              sx={{
                padding: "12px 20px",
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
              Update
            </Button>
          </Box>
        </Box>
      </Container>
    </>
  );
}
