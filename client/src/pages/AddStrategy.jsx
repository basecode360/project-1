import React from 'react';
import { Box } from '@mui/material';
import Header from '../componentsForHome/Header';
import Footer from '../componentsForHome/Footer';
import AddStrategyForm from '../componentsForEditListing/AddStrategyForm';
import { userStore } from '../store/authStore';

export default function AddStrategy({ handleLogout }) {
  const user = userStore((store) => store.user);

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header handleLogout={handleLogout} />

      <Box sx={{ flex: 1, py: 4 }}>
        <AddStrategyForm />
      </Box>

      <Footer />
    </Box>
  );
}
