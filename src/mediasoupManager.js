const mediasoup = require("mediasoup");

let worker;
const rooms = new Map(); // sessionId => { router, peers }

async function initWorker() {
  worker = await mediasoup.createWorker();
  console.log("[Mediasoup] Worker initialized");

  worker.on("died", async () => {
    console.error("Mediasoup worker died. Exiting...");
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  });
}

async function createRoom(sessionId) {
  if (rooms.has(sessionId)) return rooms.get(sessionId);

  const router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {
          "x-google-start-bitrate": 1000000, // Start at 1Mbps
          "x-google-max-bitrate": 2000000, // Max 2Mbps
          "x-google-min-bitrate": 100000, // Min 100Kbps
        }
      },
    ],
  });

  const room = {
    router,
    peers: new Map(),
  };

  rooms.set(sessionId, room);
  return room;
}

function getRoom(sessionId) {
  return rooms.get(sessionId);
}

module.exports = {
  initWorker,
  createRoom,
  getRoom,
  rooms,
};
