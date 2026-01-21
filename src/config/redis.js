const redis = require("redis");

const client = redis.createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  socket: {
    reconnectStrategy: () => {
      console.warn("🔁 Redis attempting to reconnect...");
      return 1000;
    },
  },
});

client.on("error", (err) => console.error("Redis Client Error:", err));
client.on("connect", () => console.log("✅ Redis connected"));

(async () => {
  await client.connect();
})();

module.exports = client;
