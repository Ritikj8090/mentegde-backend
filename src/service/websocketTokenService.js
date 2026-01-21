const jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.JWT_SECRET;

const websocketTokenService = {
  generateToken: async (userId) => {
    const token = jwt.sign({ userId }, SECRET_KEY, { expiresIn: "15m" });
    return token;
  },

  verifyToken: async (token) => {
    try {
      const decoded = jwt.verify(token, SECRET_KEY);
      return decoded; // contains { userId }
    } catch (err) {
      throw new Error("Invalid or expired WebSocket token");
    }
  },

  invalidateToken: async (token) => {
    await websocketTokenRepository.deleteToken(token);
  },

  refreshTokenHandler: async (req, res) => {
    try {
      const userId = req.user.id;
      const websocketToken = await websocketTokenService.generateToken(userId);
      return res.json({ websocketToken });
    } catch (error) {
      console.error("Failed to refresh WebSocket token:", error);
      return res.status(500).json({ error: "Failed to refresh token" });
    }
  },
};

module.exports = websocketTokenService;
