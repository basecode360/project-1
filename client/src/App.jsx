import React, { useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import "./App.css";
import Login from "./pages/Login";
import Home from "./pages/Home";
import EditListing from "./pages/EditListing";
import CompetitorDetails from "./componentsForEditListing/CompetitorDetails";
import { userStore } from "./store/authStore";
import PriceStrategy from "./pages/PriceStrategy";
import EditProductPrice from "./pages/EditPrice";
import AddStrategy from "./pages/AddStrategy";
import CompetitorRule from "./pages/CompetitorRule";

function App() {
  // State to manage login status
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const user = userStore(store => store.user)
  const authToken = userStore(store => store.authToken)

  const handleLogin = () => {
    setIsLoggedIn(true); // Set login state to true when the user logs in
  };

  const handleLogout = () => {
    setIsLoggedIn(false); // Set login state to false when the user logs out
  };

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={<Navigate to={isLoggedIn || user || authToken ? "/home" : "/login"} />}
        />
        <Route path="/login" element={<Login handleLogin={handleLogin} />} />
        <Route
          path="/home"
          element={
            isLoggedIn || user ? (
              <Home handleLogout={handleLogout} />
            ) : (
              <Navigate to="/login" />
            )
          }
        >
          <Route path="edit-listing" element={<EditListing />} />
          <Route path="edit-price" element={<EditProductPrice />} />
          <Route path="update-strategy" element={<PriceStrategy />} />
          <Route path="competitors/:itemId" element={<CompetitorDetails />} />
          <Route path="add-strategy" element={<AddStrategy />} />
          <Route path="add-competitor-rule" element={<CompetitorRule />} />

        </Route>
      </Routes>
    </Router>
  );
}

export default App;
