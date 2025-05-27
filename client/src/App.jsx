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
import EditPrice from "./componentsForEditListing/PriceForm";

function App() {
  // State to manage login status
  const [isLoggedIn, setIsLoggedIn] = useState(false);

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
          element={<Navigate to={isLoggedIn ? "/home" : "/login"} />}
        />
        <Route path="/login" element={<Login handleLogin={handleLogin} />} />
        <Route
          path="/home"
          element={
            isLoggedIn ? (
              <Home handleLogout={handleLogout} />
            ) : (
              <Navigate to="/login" />
            )
          }
        >
          <Route path="edit-listing" element={<EditListing />} />
          <Route path="edit-price" element={<EditPrice />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
