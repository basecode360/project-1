// src/AppRoutes.jsx - UPDATED with productId parameter for price-strategy
import React, { useState, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { useAuth } from './hooks/useAuth'; // FIXED: Use named import
import useAuthStore from './store/authStore';
import getValidAuthToken from './utils/getValidAuthToken';

// Import your page components
const Login = React.lazy(() => import('./pages/Login.jsx'));
const Home = React.lazy(() => import('./pages/Home.jsx'));
const EditListing = React.lazy(() => import('./pages/EditListing.jsx'));
const PricingStrategiesPage = React.lazy(() =>
  import('./pages/PricingStrategiesPage.jsx')
);
const CompetitorsPage = React.lazy(() => import('./pages/CompetitorsPage.jsx'));

// Import missing components
const PriceStrategy = React.lazy(() => import('./pages/PriceStrategy.jsx'));
const CompetitorDetails = React.lazy(() =>
  import('./componentsForEditListing/CompetitorDetails.jsx')
);
const AddCompetitorManually = React.lazy(() =>
  import('./componentsForEditListing/AddCompetitorManually.jsx')
);
const AddStrategy = React.lazy(() => import('./pages/AddStrategy.jsx'));
const CompetitorRule = React.lazy(() => import('./pages/CompetitorRule.jsx'));
const EditStrategyPage = React.lazy(() =>
  import('./pages/EditStrategyPage.jsx')
);
const EditCompetitorRulePage = React.lazy(() =>
  import('./pages/EditCompetitorRulePage.jsx')
);

// FIXED Protected Route component
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth(); // FIXED: Use named import

  console.log('🛡️ ProtectedRoute check:', {
    isAuthenticated,
    loading,
    timestamp: Date.now(),
  });

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div>Loading...</div>
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

export default function AppRoutes() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const user = useAuthStore((store) => store.user);
  const location = useLocation();

  useEffect(() => {
    // Only attempt to refresh eBay token if user is already logged in
    if (!user) return;
    if (
      location.pathname === '/login' ||
      location.pathname === '/auth/popup-callback'
    ) {
      return; // skip auto‐refresh on login or popup callback
    }

    console.log('🔄 Attempting eBay token refresh for user:', user.id);

    (async () => {
      try {
        await getValidAuthToken(user.id);
        console.log('✅ eBay token refresh successful');
      } catch (err) {
        console.warn(
          '⚠️ Could not refresh eBay token. User may need to reconnect:',
          err.message
        );
      }
    })();
  }, [user, location.pathname]);

  return (
    <React.Suspense
      fallback={
        <div className="flex justify-center items-center min-h-screen">
          <div>Loading application...</div>
        </div>
      }
    >
      <Routes>
        <Route
          path="/login"
          element={<Login handleLogin={() => setIsLoggedIn(true)} />}
        />
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        >
          {/* Nested route for price strategy */}
          <Route
            path="price-strategy/:productId"
            element={<PriceStrategy />}
          />
        </Route>
        <Route
          path="/edit-listing/:itemId"
          element={
            <ProtectedRoute>
              <EditListing />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pricing-strategies"
          element={
            <ProtectedRoute>
              <PricingStrategiesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/competitors"
          element={
            <ProtectedRoute>
              <CompetitorsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/competitor-details/:itemId"
          element={
            <ProtectedRoute>
              <CompetitorDetails />
            </ProtectedRoute>
          }
        />
        <Route
          path="/add-competitor-manually/:itemId"
          element={
            <ProtectedRoute>
              <AddCompetitorManually />
            </ProtectedRoute>
          }
        />
        <Route
          path="/add-strategy"
          element={
            <ProtectedRoute>
              <AddStrategy />
            </ProtectedRoute>
          }
        />
        <Route
          path="/competitor-rule"
          element={
            <ProtectedRoute>
              <CompetitorRule />
            </ProtectedRoute>
          }
        />
        <Route
          path="/edit-strategy/:id"
          element={
            <ProtectedRoute>
              <EditStrategyPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/edit-competitor-rule/:id"
          element={
            <ProtectedRoute>
              <EditCompetitorRulePage />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/home" replace />} />
      </Routes>
    </React.Suspense>
  );
}
