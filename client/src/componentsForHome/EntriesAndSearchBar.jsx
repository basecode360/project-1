// src/componentsForHome/EntriesAndSearchBar.jsx - CLEAN VERSION without Zustand
import React, { useState } from 'react';
import {
  Box,
  TextField,
  InputAdornment,
  Typography,
  Container,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

export default function EntriesAndSearchBar({ onSearchChange }) {
  const [searchTerm, setSearchTerm] = useState('');

  const handleSearchChange = (event) => {
    const value = event.target.value;
    setSearchTerm(value);

    // Call parent callback if provided
    if (onSearchChange) {
      onSearchChange(value);
    }
  };

  return (
    <Container sx={{ mt: 2, mb: 3 }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        {/* Search Bar */}
        <Box sx={{ flexGrow: 1, maxWidth: 400 }}>
          <TextField
            variant="outlined"
            placeholder="Search listings..."
            value={searchTerm}
            onChange={handleSearchChange}
            size="small"
            fullWidth
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
              sx: {
                borderRadius: 2,
                backgroundColor: '#f8f9fa',
                '&:hover': {
                  backgroundColor: '#ffffff',
                },
                '&.Mui-focused': {
                  backgroundColor: '#ffffff',
                },
              },
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                '& fieldset': {
                  borderColor: '#e0e0e0',
                },
                '&:hover fieldset': {
                  borderColor: '#1976d2',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#1976d2',
                },
              },
            }}
          />
        </Box>

        {/* Optional: Show search results count */}
        {searchTerm && (
          <Typography variant="body2" color="textSecondary">
            Searching for: "{searchTerm}"
          </Typography>
        )}
      </Box>
    </Container>
  );
}
