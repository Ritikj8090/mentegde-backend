const WebSocket = require("ws");
const websocketTokenService = require("./service/websocketTokenService"); // ✅ adjust the path if needed
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const chatService = require("./service/chatService");
const redisClient = require("./config/redis");
const db = require("./config/db");
const {
  addParticipant,
  removeParticipant,
} = require("./Repository/sessionRepository");

const {
  broadcastToUser,
  setupRedisSubscriber,
  deliverOfflineMessages,
  trackPendingAck,
  startRetryingAcks,
  stopRetryingAcks,
} = require("./utils/socketUtils"); // (you will create this small util)
const {
  initWorker,
  createRoom,
  getRoom,
  rooms,
} = require("./mediasoupManager");

async function createWebSocketServer(server) {
  const onlineUserConnections = new Map(); // userId -> Set of WebSocket connections

  await initWorker(); // 👈 Start mediasoup worker

  const subClient = redisClient.duplicate();
  await subClient.connect();

  const wss = new WebSocket.Server({ noServer: true });

  await setupRedisSubscriber(wss);
  startRetryingAcks(wss);

  const clientIdMap = new Map();

  await subClient.subscribe("mentor:liveStatus", async (message) => {
    const { mentorId, isLive } = JSON.parse(message);
    if (!mentorId || mentorId === "undefined") return;

    console.log(
      `🔔 Received Redis event: mentor ${mentorId} is now ${
        isLive ? "LIVE" : "OFFLINE"
      }`
    );

    // 👇 Clean up mediasoup room if offline
    if (!isLive) {
      const room = getRoom(mentorId);
      if (room) {
        console.log(`[Mediasoup] Cleaning up room for mentor ${mentorId}`);
        room.close && room.close();
      }
    }

    // ✅ Broadcast live status change to all connected frontend clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: "mentorLiveStatus",
            data: {
              userId: mentorId,
              isLive,
            },
          })
        );
      }
    });
  });

  server.on("upgrade", async (request, socket, head) => {
    const url = new URL(request.url, `https://${request.headers.host}`);
    if (url.pathname === "/chat") {
      return;
    }
    const token = url.searchParams.get("token");

    if (!token) {
      console.warn("❌ No token in WebSocket upgrade");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      const decoded = await websocketTokenService.verifyToken(token);
      console.log("✅ WebSocket token verified:", decoded); // ADD THIS

      request.user = decoded;

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.user = decoded;
        ws.userId = decoded.userId;
        ws.isAuthenticated = true;
        wss.emit("connection", ws, request);
      });
    } catch (err) {
      console.error("❌ Invalid WebSocket token:", err.message);
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
    }
  });

  function heartbeat() {
    this.isAlive = true;
  }

  wss.on("connection", async (ws) => {
    ws.isAlive = true;
    ws.on("pong", heartbeat);

    const clientId = crypto.randomUUID();
    clientIdMap.set(ws, clientId);
    console.log(`🎥 WebSocket client connected: ${clientId}`);

    ws.on("message", async (raw) => {
      const msg = JSON.parse(raw);

      const { type, peerId, sessionId, direction, data } = msg;

      const room = await createRoom(sessionId);

      switch (type) {
        case "joinSession": {
          console.log(`[WebSocket] Peer ${peerId} joined session ${sessionId}`);

          ws.sessionId = sessionId;
          ws.peerId = peerId;

          const existing = room.peers.get(peerId);
          if (existing) {
            console.warn(
              `⚠️ Peer ${peerId} already exists in session. Cleaning up...`
            );
            if (existing.transports) {
              Object.values(existing.transports).forEach((t) => t?.close());
            }
            if (existing.producer) {
              existing.producer.close();
            }
            if (existing.consumers) {
              existing.consumers.forEach((c) => c?.close());
            }
            room.peers.delete(peerId);
          }

          room.peers.set(peerId, {
            transports: {},
            consumers: [],
            producer: null,
          });

          if (ws.userId) {
            await addParticipant(sessionId, ws.userId); // ✅ NEW
          }

          break;
        }

        case "getRtpCapabilities":
          ws.send(
            JSON.stringify({
              type: "rtpCapabilities",
              data: room.router.rtpCapabilities,
            })
          );
          break;

        case "createTransport": {
          const transport = await room.router.createWebRtcTransport({
            listenIps: [{ ip: "0.0.0.0", announcedIp: "127.0.0.1" }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,

            // Add congestion control
            maxIncomingBitrate: 1500000,
            initialAvailableOutgoingBitrate: 1000000,
            enableSctp: false, // Disable for better performance
          });

          // Monitor transport stats
          setInterval(async () => {
            try {
              const stats = await transport.getStats();
              const rtt = stats.find(
                (s) => s.type === "candidate-pair"
              )?.currentRoundTripTime;

              if (rtt > 0.3) {
                // High RTT detected
                ws.send(
                  JSON.stringify({
                    type: "connectionWarning",
                    data: { rtt, transportId: transport.id },
                  })
                );
              }
            } catch (err) {
              console.log("Stats error:", err);
            }
          }, 2000);

          room.peers.set(peerId, {
            ...(room.peers.get(peerId) || {}),
            transports: {
              ...(room.peers.get(peerId)?.transports || {}),
              [direction]: transport,
            },
          });

          transport.observer.on("close", () =>
            console.log(`Transport closed: ${transport.id}`)
          );

          ws.send(
            JSON.stringify({
              type: "transportCreated",
              direction,
              data: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
              },
            })
          );
          break;
        }

        case "connectTransport": {
          const peer = room.peers.get(peerId);
          const transport = peer?.transports?.[direction];

          if (!transport) {
            return ws.send(
              JSON.stringify({ type: "error", message: "Transport not found" })
            );
          }

          if (transport.__connected) {
            console.warn(`Transport ${transport.id} already connected`);
            return;
          }

          await transport.connect({ dtlsParameters: data.dtlsParameters });
          transport.__connected = true; // ✅ flag it
          ws.send(JSON.stringify({ type: "transportConnected", direction }));
          break;
        }

        case "produce": {
          const transport = room.peers.get(peerId)?.transports?.[direction];
          if (!transport) {
            return ws.send(
              JSON.stringify({ type: "error", message: "Transport not found" })
            );
          }

          const producer = await transport.produce({
            kind: data.kind,
            rtpParameters: data.rtpParameters,
            encodings: [
              { rid: "r0", maxBitrate: 150000, scaleResolutionDownBy: 4.0 }, // 240p
              { rid: "r1", maxBitrate: 500000, scaleResolutionDownBy: 2.0 }, // 480p
              { rid: "r2", maxBitrate: 1000000, scaleResolutionDownBy: 1.0 }, // 720p
            ],
            codecOptions: {
              videoGoogleStartBitrate: 1000,
            },
          });

          // ✅ Store by kind (audio/video)
          const peer = room.peers.get(peerId);
          if (!peer.producers) peer.producers = {};
          peer.producers[data.kind] = producer;

          producer.on("transportclose", () =>
            console.log(`[Mediasoup] ${data.kind} producer transport closed`)
          );

          ws.send(
            JSON.stringify({
              type: "produced",
              id: producer.id,
              kind: data.kind,
            })
          );
          break;
        }

        case "consume": {
          const { kind, rtpCapabilities } = data;
          const peer = room.peers.get(peerId);
          const transport = peer?.transports?.[direction];

          if (!transport) {
            return ws.send(
              JSON.stringify({ type: "error", message: "Transport not found" })
            );
          }

          // 🔁 Look for producer of requested kind (audio/video)
          let producer = null;
          for (const [id, p] of room.peers.entries()) {
            if (id !== peerId && p.producers?.[kind]) {
              producer = p.producers[kind];
              break;
            }
          }

          if (!producer) {
            return ws.send(
              JSON.stringify({
                type: "error",
                message: `No ${kind} producer found`,
              })
            );
          }

          if (
            !room.router.canConsume({
              producerId: producer.id,
              rtpCapabilities,
            })
          ) {
            return ws.send(
              JSON.stringify({
                type: "error",
                message: `Can't consume ${kind}`,
              })
            );
          }

          const consumer = await transport.consume({
            producerId: producer.id,
            rtpCapabilities,
            paused: false,
          });

          if (!peer.consumers) peer.consumers = [];
          peer.consumers.push(consumer);

          consumer.on("transportclose", () =>
            console.log(`[Mediasoup] ${kind} consumer transport closed`)
          );

          ws.send(
            JSON.stringify({
              type: "consumed",
              data: {
                id: consumer.id,
                producerId: producer.id,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
              },
            })
          );
          break;
        }

        case "resume": {
          const consumer = room.peers.get(peerId)?.consumers?.[0];
          if (consumer) await consumer.resume();
          break;
        }

        case "hasProducer": {
          const availableKinds = {};
          for (const [id, peer] of room.peers.entries()) {
            if (id !== peerId && peer.producers) {
              if (peer.producers["video"]) availableKinds.video = true;
              if (peer.producers["audio"]) availableKinds.audio = true;
            }
          }
          ws.send(
            JSON.stringify({
              type: "hasProducer",
              data: { availableKinds },
            })
          );
          break;
        }

        case "getStats": {
          const peer = room.peers.get(peerId);
          if (peer?.consumers) {
            const stats = await Promise.all(
              peer.consumers.map((c) => c.getStats())
            );

            ws.send(
              JSON.stringify({
                type: "statsUpdate",
                data: { stats, peerId },
              })
            );
          }
          break;
        }

        // Add connection quality handler
        case "connectionQuality": {
          const { quality, peerId } = msg.data; // poor/good/excellent
          const peer = room.peers.get(peerId);

          if (quality === "poor" && peer?.consumers) {
            // Pause video, keep audio
            const videoConsumer = peer.consumers.find(
              (c) => c.kind === "video"
            );
            if (videoConsumer && !videoConsumer.paused) {
              await videoConsumer.pause();
              ws.send(
                JSON.stringify({
                  type: "streamPaused",
                  reason: "poor_connection",
                  kind: "video",
                })
              );
            }
          } else if (quality === "good" && peer?.consumers) {
            // Resume video
            const videoConsumer = peer.consumers.find(
              (c) => c.kind === "video"
            );
            if (videoConsumer && videoConsumer.paused) {
              await videoConsumer.resume();
              ws.send(
                JSON.stringify({
                  type: "streamResumed",
                  kind: "video",
                })
              );
            }
          }
          break;
        }

        // Add buffering control
        case "setBuffering": {
          const { buffering, peerId } = msg.data;
          const peer = room.peers.get(peerId);

          if (buffering && peer?.consumers) {
            // Reduce quality temporarily
            peer.consumers.forEach(async (consumer) => {
              if (consumer.kind === "video") {
                await consumer.setPreferredLayers({
                  spatialLayer: 0, // Lowest quality
                  temporalLayer: 0,
                });
              }
            });
          }
          break;
        }

        case "chatMessage": {
          const { sessionId, payload } = msg;

          // Broadcast message to all clients in the same session
          wss.clients.forEach((client) => {
            if (
              client.readyState === WebSocket.OPEN &&
              client.sessionId === sessionId
            ) {
              client.send(
                JSON.stringify({
                  type: "chatMessage",
                  payload,
                })
              );
            }
          });

          break;
        }

        case "joinConversation": {
          const userId = ws.userId; // ✅ from decoded JWT, not client
          const { conversationId, limit = 50, offset = 0 } = msg.payload;
          ws.sessionId = conversationId;

          console.log(
            "📩 Incoming WS:",
            msg.type,
            "from session",
            ws.sessionId
          );

          try {
            console.log(
              `🔵 User ${userId} joining conversation ${conversationId}`
            );

            const messages = await chatService.getMessagesByConversationId(
              conversationId,
              limit,
              offset
            );

            // Send back the chat history
            ws.send(
              JSON.stringify({
                type: "chatHistory",
                payload: {
                  conversationId,
                  messages,
                },
              })
            );
          } catch (err) {
            console.error("❌ Error fetching chat history:", err);
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Failed to fetch chat history",
              })
            );
          }
          break;
        }

        case "privateMessage": {
          const { senderId, receiverId, text } = msg.payload;

          const { conversation, savedMessage } = await chatService.sendMessage(
            senderId,
            receiverId,
            text
          );
          ws.sessionId = conversation.id;

          const outgoingMessage = {
            type: "newPrivateMessage",
            payload: {
              conversationId: conversation.id,
              message: savedMessage,
            },
          };

          const wasSent = broadcastToUser(wss, receiverId, outgoingMessage); // Try to send immediately

          if (!wasSent) {
            // ✅ Store in Redis for offline delivery
            await redisClient.rPush(
              `offline:messages:${receiverId}`,
              JSON.stringify(outgoingMessage)
            );
          }
          // ACK back to sender immediately
          ws.send(
            JSON.stringify({
              type: "messageSent",
              payload: { messageId: savedMessage.id },
            })
          );

          // Save pending ack tracking
          savedMessage.status = "sent";
          savedMessage.timestamp = Date.now();
          trackPendingAck(savedMessage, receiverId);

          break;
        }

        case "messageAck": {
          const { messageId } = msg.payload;
          if (pendingAcks.has(messageId)) {
            console.log(`✅ Message ACK received for ${messageId}`);
            pendingAcks.delete(messageId);
            await db.query(
              `UPDATE mentedge.chat_messages
               SET status = 'delivered', delivered_at = now(), updated_at = now()
               WHERE id = $1`,
              [messageId]
            );
          }
          break;
        }

        case "userTyping": {
          const { sessionId, userId } = msg.payload;

          // Broadcast typing event to all clients in the same live session
          wss.clients.forEach((client) => {
            if (
              client.readyState === WebSocket.OPEN &&
              client.sessionId === sessionId &&
              client.userId !== userId
            ) {
              client.send(
                JSON.stringify({
                  type: "userTyping",
                  payload: { userId },
                })
              );
            }
          });

          break;
        }

        case "joinLiveSession": {
          const { sessionId, userId } = msg.payload;

          ws.sessionId = sessionId;
          ws.userId = userId;

          // Notify others that a user joined
          wss.clients.forEach((client) => {
            if (
              client.readyState === WebSocket.OPEN &&
              client.sessionId === sessionId &&
              client !== ws
            ) {
              client.send(
                JSON.stringify({
                  type: "userJoined",
                  payload: { userId },
                })
              );
            }
          });

          break;
        }

        case "leaveLiveSession": {
          const { sessionId, userId } = msg.payload;

          // Notify others that a user left
          wss.clients.forEach((client) => {
            if (
              client.readyState === WebSocket.OPEN &&
              client.sessionId === sessionId &&
              client !== ws
            ) {
              client.send(
                JSON.stringify({
                  type: "userLeft",
                  payload: { userId },
                })
              );
            }
          });

          await removeParticipant(sessionId, userId);
          break;
        }

        case "userOnline": {
          const { userId } = msg.payload;
          if (!ws.userId) ws.userId = userId;

          if (!onlineUserConnections.has(userId)) {
            onlineUserConnections.set(userId, new Set());
          }
          onlineUserConnections.get(userId).add(ws);

          // Save user's presence in Redis with a short TTL (e.g., 60s)
          await redisClient.set(`presence:${userId}`, "online", { EX: 60 });

          // Deliver offline messages
          const messages = await redisClient.lRange(
            `offline:messages:${userId}`,
            0,
            -1
          );
          if (messages?.length) {
            for (const raw of messages) ws.send(raw);
            await redisClient.del(`offline:messages:${userId}`);
          }

          // Broadcast to others
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client !== ws) {
              client.send(
                JSON.stringify({
                  type: "userStatus",
                  payload: { userId, online: true },
                })
              );
            }
          });

          break;
        }

        case "userOffline": {
          const { userId } = msg.payload;

          // Remove presence from Redis
          await redisClient.del(`presence:${userId}`);

          // Notify all others
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client !== ws) {
              client.send(
                JSON.stringify({
                  type: "userStatus",
                  payload: { userId, online: false },
                })
              );
            }
          });

          break;
        }

        case "acknowledgeMessages": {
          const { payload } = msg;
          if (
            !payload ||
            !payload.conversationId ||
            !Array.isArray(payload.messageIds)
          ) {
            console.warn("Invalid acknowledgeMessages payload:", payload);
            return;
          }

          const { conversationId, messageIds } = payload;
          for (const messageId of messageIds) {
            await db.query(
              `UPDATE mentedge.chat_messages
               SET status = 'delivered', delivered_at = NOW(), updated_at = NOW()
               WHERE id = $1`,
              [messageId]
            );
          }
          break;
        }

        default:
          ws.send(
            JSON.stringify({
              type: "error",
              message: `Unknown message: ${type}`,
            })
          );
      }
    });

    // Add after message switch statement
    ws.on("error", (error) => {
      console.log("WebSocket error:", error);

      // Send low-quality stream info to other clients
      wss.clients.forEach((client) => {
        if (
          client.readyState === WebSocket.OPEN &&
          client.sessionId === ws.sessionId &&
          client !== ws
        ) {
          client.send(
            JSON.stringify({
              type: "peerConnectionIssue",
              peerId: ws.peerId,
              fallback: true,
            })
          );
        }
      });
    });

    // 🔁 Optional Redis-based presence validation fallback
    const presenceCheck = setInterval(async () => {
      for (const [userId, conns] of onlineUserConnections.entries()) {
        const isOnline = await redisClient.exists(`presence:${userId}`);
        if (!isOnline) {
          console.log(`⛔ User ${userId} expired from Redis. Marking offline.`);
          onlineUserConnections.delete(userId);

          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  type: "userStatus",
                  payload: { userId, online: false },
                })
              );
            }
          });
        }
      }
    }, 60000); // Run every 60 seconds

    ws.on("close", async () => {
      const userId = ws.userId;

      if (ws.sessionId && ws.userId) {
        try {
          await removeParticipant(ws.sessionId, ws.userId);
          console.log(
            `🧹 Removed participant ${ws.userId} from session ${ws.sessionId}`
          );
        } catch (err) {
          console.error("❌ Failed to remove participant:", err);
        }
      }

      if (userId && onlineUserConnections.has(userId)) {
        const connections = onlineUserConnections.get(userId);
        connections.delete(ws);
        if (connections.size === 0) {
          onlineUserConnections.delete(userId);

          // Notify others user went offline
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client !== ws) {
              client.send(
                JSON.stringify({
                  type: "userStatus",
                  payload: { userId, online: false },
                })
              );
            }
          });
        }
      }

      ws.sessionId = null; // ✅ cleanup
      ws.peerId = null;
      // Cleanup peer
      for (const [sessionId, room] of rooms.entries()) {
        const peer = room.peers.get(clientId);
        if (peer) {
          console.log(
            `🧹 Cleaning up peer ${clientId} in session ${sessionId}`
          );

          // Close transports
          if (peer.transports) {
            Object.values(peer.transports).forEach((t) => t?.close());
          }

          // Close producer
          if (peer.producer) {
            peer.producer.close();
          }

          // Close consumers
          if (peer.consumers) {
            peer.consumers.forEach((c) => c.close());
          }

          room.peers.delete(clientId);
        }
      }
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        const userId = ws.userId;
        if (userId && onlineUserConnections.has(userId)) {
          const conns = onlineUserConnections.get(userId);
          conns.delete(ws);
          if (conns.size === 0) {
            onlineUserConnections.delete(userId);
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN && client !== ws) {
                client.send(
                  JSON.stringify({
                    type: "userStatus",
                    payload: { userId, online: false },
                  })
                );
              }
            });
          }
        }

        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 15000);
  // Every 15 seconds

  wss.on("close", () => {
    clearInterval(interval);
    clearInterval(presenceCheck);
    stopRetryingAcks();
  });

  return wss;
}

module.exports = { createWebSocketServer };
