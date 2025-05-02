import React from "react";
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
} from "@mui/material";
import { useNavigate } from "react-router-dom";

const rows = [
  {
    productTitle:
      "Front Fog Light Cover Right Passenger Side Textured For 2013-2015 Nissan Altima",
    productId: "186855612214",
    status: ["New", "Active"],
    qty: 9,
    myPrice: "USD7.74",
    competition: "USD7.75",
    strategy: "0.01",
    minPrice: "USD7.00",
    maxPrice: "USD25.00",
    competitors: 13,
  },
  {
    productTitle:
      "Fog Light Cover Left & Right Side Textured For 2013-2015 Nissan Altima Sedan",
    productId: "186871987525",
    status: ["New", "Active"],
    qty: 11,
    myPrice: "USD17.99",
    competition: "USD18.00",
    strategy: "0.01",
    minPrice: "USD14.00",
    maxPrice: "USD30.00",
    competitors: 7,
  },
  {
    productTitle:
      "Front Fog Light Cover Right Passenger Side Textured For 2013-2015 Nissan Altima",
    productId: "186855612214",
    status: ["New", "Active"],
    qty: 9,
    myPrice: "USD7.74",
    competition: "USD7.75",
    strategy: "0.01",
    minPrice: "USD7.00",
    maxPrice: "USD25.00",
    competitors: 13,
  },
  {
    productTitle:
      "Fog Light Cover Left & Right Side Textured For 2013-2015 Nissan Altima Sedan",
    productId: "186871987525",
    status: ["New", "Active"],
    qty: 11,
    myPrice: "USD17.99",
    competition: "USD18.00",
    strategy: "0.01",
    minPrice: "USD14.00",
    maxPrice: "USD30.00",
    competitors: 7,
  },
  {
    productTitle:
      "Front Fog Light Cover Right Passenger Side Textured For 2013-2015 Nissan Altima",
    productId: "186855612214",
    status: ["New", "Active"],
    qty: 9,
    myPrice: "USD7.74",
    competition: "USD7.75",
    strategy: "0.01",
    minPrice: "USD7.00",
    maxPrice: "USD25.00",
    competitors: 13,
  },
  {
    productTitle:
      "Fog Light Cover Left & Right Side Textured For 2013-2015 Nissan Altima Sedan",
    productId: "186871987525",
    status: ["New", "Active"],
    qty: 11,
    myPrice: "USD17.99",
    competition: "USD18.00",
    strategy: "0.01",
    minPrice: "USD14.00",
    maxPrice: "USD30.00",
    competitors: 7,
  },
];

export default function ListingsTable() {
  const navigate = useNavigate();

  return (
    <Container sx={{ mt: 4, mb: 2 }}>
      <TableContainer
        component={Paper}
        sx={{ borderRadius: 2, border: "1px solid #ddd" }}
      >
        <Table sx={{ minWidth: 650 }}>
          <TableHead>
            <TableRow
              sx={{
                backgroundColor: "#ffffff", // Clean white background for modern look
                borderBottom: "2px solid #e0e0e0", // Soft line separating header from body
                boxShadow: "0px 4px 10px rgba(0, 0, 0, 0.1)", // Soft shadow for depth
                "&:hover": {
                  backgroundColor: "#f9f9f9", // Light color on hover for rows
                },
                transition: "background-color 0.3s ease", // Smooth transition for hover effect
              }}
            >
              {[
                "Product",
                "Qty",
                "My Price",
                "Competitors Rule",
                "Competition",
                "Strategy",
                "Min Price",
                "Max Price",
                "Competitors",
              ].map((header) => (
                <TableCell
                  key={header}
                  sx={{
                    fontWeight: "600", // Bold font for header
                    fontSize: "15px", // Larger font size for readability
                    textAlign: "left", // Center-align text in each cell
                    padding: "8px", // More padding for balance
                    borderRight: "1px solid #ddd", // Light border for separation between columns
                    color: "#333", // Darker text for better contrast
                    backgroundColor: "#fafafa", // Subtle background for each cell
                    "&:last-child": {
                      borderRight: "none", // Remove right border for the last cell in each row
                    },
                    "&:hover": {
                      backgroundColor: "#f5f5f5", // Light color change when hovering over individual header cell
                      color: "#1976d2", // Change text color to blue on hover for interactivity
                    },
                    transition: "all 0.3s ease", // Smooth transition for hover effect
                  }}
                >
                  {header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {rows.map((row, idx) => (
              <TableRow
                key={idx}
                sx={{
                  "&:hover": {
                    backgroundColor: "#f5f5f5", // Light hover effect for the rows
                    boxShadow: "0px 4px 8px rgba(0, 0, 0, 0.1)", // Soft shadow effect on hover
                    cursor: "pointer", // Indicate interactivity
                  },
                  transition: "all 0.3s ease", // Smooth transition for hover effect
                }}
              >
                <TableCell
                  sx={{
                    border: "1px solid #ddd",
                    padding: "10px",
                    backgroundColor: "#fff",
                  }}
                >
                  <Box>
                    <Link
                      href="#"
                      underline="hover"
                      color="primary"
                      fontSize={16} // Larger font size for better readability
                      sx={{ fontWeight: 600 }} // Bold font for visibility
                    >
                      {row.productTitle}
                    </Link>
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      display="block"
                      sx={{ fontSize: "14px" }} // Slightly smaller text for the product ID and status
                    >
                      {row.productId} |{" "}
                      {row.status.map((s, i) => (
                        <Typography
                          key={i}
                          component="span"
                          color={s === "Active" ? "#1e852b" : "gray"}
                          sx={{ mx: 0.5 }}
                        >
                          {s}
                        </Typography>
                      ))}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell
                  sx={{
                    border: "1px solid #ddd",
                    padding: "16px",
                    backgroundColor: "#fff",
                  }}
                >
                  {row.qty}
                </TableCell>
                <TableCell
                  sx={{
                    border: "1px solid #ddd",
                    padding: "16px",
                    backgroundColor: "#fff",
                  }}
                >
                  {row.myPrice}
                </TableCell>
                <TableCell
                  sx={{
                    border: "1px solid #ddd",
                    padding: "16px",
                    backgroundColor: "#fff",
                  }}
                >
                  <Typography
                    color="primary"
                    sx={{
                      cursor: "pointer",
                      textDecoration: "underline",
                      fontSize: "16px", // Larger font size for clarity
                    }}
                    onClick={() => navigate("/home/edit-listing")}
                  >
                    Assign Rule
                  </Typography>
                </TableCell>
                <TableCell
                  sx={{
                    border: "1px solid #ddd",
                    padding: "16px",
                    backgroundColor: "#fff",
                  }}
                >
                  {row.competition}
                </TableCell>
                <TableCell
                  sx={{
                    border: "1px solid #ddd",
                    padding: "16px",
                    backgroundColor: "#fff",
                  }}
                >
                  <Typography
                    color="primary"
                    sx={{
                      cursor: "pointer",
                      fontSize: "16px", // Larger font size for clarity
                      "&:hover": {
                        textDecoration: "underline",
                      },
                    }}
                    onClick={() => navigate("/home/edit-listing")}
                  >
                    {row.strategy}
                  </Typography>
                </TableCell>
                <TableCell
                  sx={{
                    border: "1px solid #ddd",
                    padding: "16px",
                    backgroundColor: "#fff",
                  }}
                >
                  <Typography
                    color="primary"
                    sx={{
                      cursor: "pointer",
                      fontSize: "16px", // Larger font size for clarity
                      "&:hover": {
                        textDecoration: "underline",
                      },
                    }}
                    onClick={() => navigate("/home/edit-listing")}
                  >
                    {row.minPrice}
                  </Typography>
                </TableCell>
                <TableCell
                  sx={{
                    border: "1px solid #ddd",
                    padding: "16px",
                    backgroundColor: "#fff",
                  }}
                >
                  <Typography
                    color="primary"
                    sx={{
                      cursor: "pointer",
                      fontSize: "16px", // Larger font size for clarity
                      "&:hover": {
                        textDecoration: "underline",
                      },
                    }}
                    onClick={() => navigate("/home/edit-listing")}
                  >
                    {row.maxPrice}
                  </Typography>
                </TableCell>
                <TableCell
                  sx={{
                    border: "1px solid #ddd",
                    padding: "16px",
                    backgroundColor: "#fff",
                  }}
                >
                  <Typography
                    color="primary"
                    sx={{
                      cursor: "pointer",
                      fontSize: "16px", // Larger font size for clarity
                      "&:hover": {
                        textDecoration: "underline",
                      },
                    }}
                    onClick={() => navigate("/home/edit-listing")}
                  >
                    {row.competitors}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Container>
  );
}
