import React from 'react';
import { Box, Button, Container } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

export default function ActionButtons() {
  return (
    <Container sx={{ mt: 4, mb: 4 }}>
      <Box
        display="flex"
        justifyContent="space-between" // Center the buttons horizontally
        alignItems="center"
       
      >
        {/* Filter Listings Button */}
        <Button
          variant="contained"
          color="error"
          startIcon={<FilterListIcon />}
          endIcon={<ArrowDropDownIcon />}
          sx={{
            textTransform: 'none',
            fontWeight: 700,
            fontSize: '18px', // Increased font size for better readability
            px: 4,
            py: 2,
            borderRadius: '50px', // Circular rounded edges for a modern look
            minWidth: 220,
            background: 'linear-gradient(145deg,rgb(45, 158, 239),rgb(12, 113, 237))', // Gradient for a modern look
            boxShadow: 'inset 2px 2px 8px rgba(0, 0, 0, 0.2)', // Inset shadow for depth
            '&:hover': {
              boxShadow: 'inset 4px 4px 10px rgba(0, 0, 0, 0.3)',
            },
            transition: 'all 0.3s ease-in-out', // Smooth transition for hover effect
          }}
        >
          Filter Listings
        </Button>

        {/* Assign Strategy Button */}
        <Button
          variant="outlined"
          sx={{
            textTransform: 'none',
            fontWeight: 700,
            fontSize: '18px',
            px: 4,
            py: 2,
            color: '#333',
            borderColor: '#ccc',
            borderRadius: '50px',
            minWidth: 250,
            marginLeft: 3, // Space between the buttons
            background: 'linear-gradient(145deg, #ffffff, #f5f5f5)', // Gradient to match neumorphism theme
            boxShadow: 'inset 2px 2px 8px rgba(0, 0, 0, 0.1)', // Inset shadow effect for depth
            '&:hover': {
              backgroundColor: '#f0f0f0', // Subtle background change on hover
              borderColor: '#999',
              boxShadow: 'inset 4px 4px 10px rgba(0, 0, 0, 0.15)',
            },
            transition: 'all 0.3s ease-in-out',
          }}
        >
          Assign a Strategy to Multiple Listings
        </Button>
      </Box>
    </Container>
  );
}
