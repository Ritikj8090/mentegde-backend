const jwt = require("jsonwebtoken");
const pool = require("../config/db");

const protect = async (req, res, next) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ message: "Not authorized, no token" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      id: decoded.id,
      full_name: decoded.full_name,
      email: decoded.email,
      avatar: decoded.avatar,
      role: decoded.role,
      gender: decoded.gender
    };
    next();
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: "Not authorized, token failed" });
  }
};

module.exports = { protect };
