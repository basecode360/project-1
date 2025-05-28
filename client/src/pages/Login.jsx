import React, { useEffect, useState } from "react";
import {
  Box,
  TextField,
  Button,
  Typography,
  Paper,
  Avatar,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import apiService from "../api/apiService"; 
import { userStore } from "../store/authStore";
// const allowedUsers = [
//   { email: "teampartstunt@gmail.com", password: "Dodge@#124578~" },
// ];

export default function Login({ handleLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const saveUser = userStore(store => store.saveUser)

// useEffect(() => {
//   if(user) {
//     navigate("/home")
//   }
// },[])

  const handleLoginClick = async () => {
    // const user = allowedUsers.find(
    //   (u) => u.email === email && u.password === password
    // );
    console.log("Login attempt with email:", email, "and password:", password);
    const response = await apiService.auth.login({ email, password });
    console.log("API response:", response);
    if (response.success) {                                          
      saveUser({email,password})
      handleLogin(); // Call the handleLogin function passed from App.js
      navigate("/home")
    } else {
      setError("Invalid email or password");
    }
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: "linear-gradient(to right, #2E3B4E, #607D8B)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
      }}
    >
      <Paper
        elevation={5}
        sx={{ p: 5, maxWidth: 400, width: "100%", borderRadius: 3 }}
      >
        <Box display="flex" flexDirection="column" alignItems="center" mb={3}>
          <Avatar sx={{ bgcolor: "#2E3B4E", mb: 1 }}>
            <LockOutlinedIcon />
          </Avatar>
          <Typography variant="h5" fontWeight={600}>
            Welcome Back
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Please login to your account
          </Typography>
        </Box>

        <TextField
          fullWidth
          label="Email Address"
          type="email"
          variant="outlined"
          margin="normal"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <Box sx={{ position: "relative" }}>
          <TextField
            fullWidth
            label="Password"
            type={showPassword ? "text" : "password"}
            variant="outlined"
            margin="normal"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            InputProps={{
              endAdornment: (
                <Box
                  sx={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    cursor: "pointer",
                  }}
                  onClick={togglePasswordVisibility}
                >
                  {showPassword ? <VisibilityOff /> : <Visibility />}
                </Box>
              ),
            }}
          />
        </Box>

        {error && (
          <Typography color="error" fontSize={14} mt={1}>
            {error}
          </Typography>
        )}

        <Button
          fullWidth
          variant="contained"
          onClick={handleLoginClick}
          sx={{
            mt: 3,
            backgroundColor: "#2E3B4E",
            "&:hover": {
              backgroundColor: "#1f2c3a",
            },
            textTransform: "none",
            fontWeight: "bold",
            py: 1.3,
          }}
        >
          Login
        </Button>
      </Paper>
    </Box>
  );
}
