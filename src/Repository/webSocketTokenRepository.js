const client = require("../config/redis");

const websocketTokenRepository = {
  saveToken: async (token, userId) => {
    if (!client.isOpen) {
      try {
        await client.connect();
      } catch (err) {
        if (!err.message.includes("already connected")) {
          console.error("Redis connect error:", err);
          throw err;
        }
      }
    }
    
    const tokenData = JSON.stringify({ userId });
    await client.setEx(`websocket:token:${token}`, 1800, tokenData); // 30 minutes TTL
  },

  getTokenData: async (token) => {
    if (!client.isOpen) {
      try {
        await client.connect();
      } catch (err) {
        if (!err.message.includes("already connected")) {
          console.error("Redis connect error:", err);
          throw err;
        }
      }
    }
    
    const tokenData = await client.get(`websocket:token:${token}`);
    return tokenData ? JSON.parse(tokenData) : null;
  },

  deleteToken: async (token) => {
    if (!client.isOpen) {
      try {
        await client.connect();
      } catch (err) {
        if (!err.message.includes("already connected")) {
          console.error("Redis connect error:", err);
          throw err;
        }
      }
    }
    
    await client.del(`websocket:token:${token}`);
  },
};

module.exports = websocketTokenRepository;
