const WebSocket = require("ws");
const redisClient = require("./config/redis");
const websocketTokenService = require("./service/websocketTokenService");
const chatRepository = require("./Repository/chatRepository");

async function createChatWebSocketServer(server) {
  const wss = new WebSocket.Server({ noServer: true });
  const userSockets = new Map(); // userId -> Set<WebSocket>
  const internshipUsers = new Map(); // internshipId -> Set<userId>

  const subClient = redisClient.duplicate();
  await subClient.connect();

  await subClient.subscribe("chat_realtime", (message) => {
    const { receiverId, payload } = JSON.parse(message);
    if (!receiverId || receiverId === "*") {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(payload));
        }
      });
      return;
    }

    const sockets = userSockets.get(receiverId);
    if (!sockets) return;

    sockets.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(payload));
      }
    });
  });

  server.on("upgrade", async (request, socket, head) => {
    const url = new URL(request.url, `https://${request.headers.host}`);
    if (url.pathname !== "/chat") {
      return;
    }

    const token = url.searchParams.get("token");
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      const decoded = await websocketTokenService.verifyToken(token);
      request.user = decoded;

      wss.handleUpgrade(request, socket, head, (ws) => {
        ws.user = decoded;
        ws.userId = decoded.userId;
        wss.emit("connection", ws, request);
      });
    } catch (err) {
      console.error("Chat WS token error:", err.message);
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
    }
  });

  wss.on("connection", (ws) => {
    const userId = ws.userId;
    if (!userId) {
      ws.close();
      return;
    }

    const existing = userSockets.get(userId) || new Set();
    existing.add(ws);
    userSockets.set(userId, existing);

    const refreshPresence = async () => {
      await redisClient.setEx(`chat_presence:${userId}`, 60, "online");
    };

    refreshPresence();
    const presenceInterval = setInterval(refreshPresence, 30000);

    // Broadcast user is online to everyone
    redisClient.publish(
      "chat_realtime",
      JSON.stringify({
        receiverId: "*",
        payload: {
          type: "userStatus",
          payload: { userId, online: true },
        },
      })
    );

    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (err) {
        ws.send(
          JSON.stringify({ type: "error", message: "Invalid JSON payload" })
        );
        return;
      }

      const { type, payload } = msg;

      if (!type) {
        ws.send(JSON.stringify({ type: "error", message: "Missing type" }));
        return;
      }

      switch (type) {
        // ✅ ADD THIS NEW CASE - Handle userStatus from client
        case "userStatus": {
          const { internshipId, online } = payload || {};
          
          if (!internshipId) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "internshipId is required",
              })
            );
            return;
          }

          // Track users by internship
          if (online) {
            if (!internshipUsers.has(internshipId)) {
              internshipUsers.set(internshipId, new Set());
            }
            internshipUsers.get(internshipId).add(userId);
            ws.currentInternship = internshipId;

            // Send current online users to this user
            const onlineUsers = Array.from(internshipUsers.get(internshipId));
            ws.send(
              JSON.stringify({
                type: "initialOnlineUsers",
                payload: {
                  userIds: onlineUsers,
                },
              })
            );
          } else {
            if (internshipUsers.has(internshipId)) {
              internshipUsers.get(internshipId).delete(userId);
            }
          }

          // Broadcast status to all users
          await redisClient.publish(
            "chat_realtime",
            JSON.stringify({
              receiverId: "*",
              payload: {
                type: "userStatus",
                payload: {
                  userId,
                  internshipId,
                  online,
                },
              },
            })
          );
          break;
        }

        case "typing": {
          const { conversationId, isTyping } = payload || {};
          if (!conversationId) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "conversationId is required",
              })
            );
            return;
          }

          const conversation = await chatRepository.getConversationById(
            conversationId
          );
          if (!conversation) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Conversation not found",
              })
            );
            return;
          }

          const isParticipant =
            (conversation.user1_id === userId) ||
            (conversation.user2_id === userId);
          if (!isParticipant) {
            ws.send(
              JSON.stringify({ type: "error", message: "Forbidden" })
            );
            return;
          }

          const receiverId =
            conversation.user1_id === userId
              ? conversation.user2_id
              : conversation.user1_id;

          await redisClient.publish(
            "chat_realtime",
            JSON.stringify({
              receiverId,
              payload: {
                type: "typing",
                payload: {
                  conversationId,
                  userId,
                  isTyping: Boolean(isTyping),
                },
              },
            })
          );
          break;
        }

        case "messageDelivered": {
          const { conversationId, messageIds } = payload || {};
          if (!conversationId || !Array.isArray(messageIds)) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "conversationId and messageIds are required",
              })
            );
            return;
          }

          const conversation = await chatRepository.getConversationById(
            conversationId
          );
          if (!conversation) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Conversation not found",
              })
            );
            return;
          }

          const isParticipant =
            conversation.user1_id === userId ||
            conversation.user2_id === userId;
          if (!isParticipant) {
            ws.send(
              JSON.stringify({ type: "error", message: "Forbidden" })
            );
            return;
          }

          const updated = await chatRepository.markMessagesDelivered(
            messageIds
          );

          const senderMap = new Map();
          updated.forEach((message) => {
            if (message.sender_id === userId) return;
            if (!senderMap.has(message.sender_id)) {
              senderMap.set(message.sender_id, []);
            }
            senderMap.get(message.sender_id).push(message.id);
          });

          for (const [senderId, ids] of senderMap.entries()) {
            await redisClient.publish(
              "chat_realtime",
              JSON.stringify({
                receiverId: senderId,
                payload: {
                  type: "messageDelivered",
                  payload: {
                    conversationId,
                    messageIds: ids,
                  },
                },
              })
            );
          }
          break;
        }

        case "messageRead": {
          const { conversationId, messageIds } = payload || {};
          if (!conversationId || !Array.isArray(messageIds)) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "conversationId and messageIds are required",
              })
            );
            return;
          }

          const conversation = await chatRepository.getConversationById(
            conversationId
          );
          if (!conversation) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Conversation not found",
              })
            );
            return;
          }

          const isParticipant =
            conversation.user1_id === userId ||
            conversation.user2_id === userId;
          if (!isParticipant) {
            ws.send(
              JSON.stringify({ type: "error", message: "Forbidden" })
            );
            return;
          }

          const updated = await chatRepository.markMessagesRead(messageIds);

          const senderMap = new Map();
          updated.forEach((message) => {
            if (message.sender_id === userId) return;
            if (!senderMap.has(message.sender_id)) {
              senderMap.set(message.sender_id, []);
            }
            senderMap.get(message.sender_id).push(message.id);
          });

          for (const [senderId, ids] of senderMap.entries()) {
            await redisClient.publish(
              "chat_realtime",
              JSON.stringify({
                receiverId: senderId,
                payload: {
                  type: "messageRead",
                  payload: {
                    conversationId,
                    messageIds: ids,
                  },
                },
              })
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

    ws.on("close", () => {
      clearInterval(presenceInterval);
      redisClient.del(`chat_presence:${userId}`);
      
      // ✅ UPDATED - Remove from internship tracking
      if (ws.currentInternship && internshipUsers.has(ws.currentInternship)) {
        internshipUsers.get(ws.currentInternship).delete(userId);
      }

      redisClient.publish(
        "chat_realtime",
        JSON.stringify({
          receiverId: "*",
          payload: {
            type: "userStatus",
            payload: { userId, online: false },
          },
        })
      );

      const set = userSockets.get(userId);
      if (!set) return;
      set.delete(ws);
      if (set.size === 0) {
        userSockets.delete(userId);
      }
    });
  });

  console.log("✅ Chat WebSocket server ready at wss://localhost:4000/chat");
}

module.exports = { createChatWebSocketServer };