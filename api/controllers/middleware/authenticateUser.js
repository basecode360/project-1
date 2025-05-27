
import User from "../../models/user.js";

const authenticateUser = async (req, res, next) => {
  const bearerToken = req.headers?.authorization;
  const token = bearerToken?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Token not provided" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    console.log(user);
     if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
     }
     req.user = user;
     next();
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
