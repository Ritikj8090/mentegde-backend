require("dotenv").config();
const jwt = require("jsonwebtoken");
const clientPromise = require("../config/redis"); // Import the Redis client promise

const SECRET_KEY = process.env.JWT_SECRET;

const authenticate = async (req, res, next) => {
  try {
    const token = req.cookies.token;
    if (!token)
      return res.status(401).json({ message: "Unauthorized: No token" });

    // Wait for the Redis client to connect
    const client = await clientPromise;

    // Check if the token is blacklisted in Redis
    const isBlacklisted = await client.get(`blacklist:${token}`);
    if (isBlacklisted) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Token is blacklisted" });
    }

    const decoded = jwt.verify(token, SECRET_KEY);

    if (
      !decoded.is_active &&
      !req.path.includes("onboard") &&
      !req.path.includes("verify")
    ) {
      return res
        .status(403)
        .json({ message: "Complete onboarding to access this feature" });
    }

    req.user = decoded;
    next();
  } catch (error) {
    console.error("Token error:", error.message);
    res.status(401).json({ message: "Unauthorized: Invalid token" });
  }
};

const authorizeRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: "Forbidden: Role not permitted" });
  }
  next();
};

module.exports = { authenticate, authorizeRole };
