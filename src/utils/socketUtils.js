const redisClient = require("../config/redis");

const pendingAcks = new Map(); // { messageId: { message, receiverId, retries } }
let retryIntervalId = null;

function broadcastToUser(wss, userId, data) {
  let isLocal = false;

  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.userId === userId) {
      client.send(JSON.stringify(data));
      isLocal = true;
    }
  });

  if (!isLocal) {
    redisClient.publish(
      "chat",
      JSON.stringify({ receiverId: userId, payload: data })
    );
  }
}

async function setupRedisSubscriber(wss) {
  const subClient = redisClient.duplicate();
  await subClient.connect();

  await subClient.subscribe("chat", (message) => {
    const { receiverId, payload } = JSON.parse(message);

    wss.clients.forEach((client) => {
      if (client.readyState === 1 && client.userId === receiverId) {
        client.send(JSON.stringify(payload));
      }
    });
  });

  console.log("✅ Redis subscription for chat ready");
}

function trackPendingAck(message, receiverId) {
  pendingAcks.set(message.id, { message, receiverId, retries: 0 });
}

function startRetryingAcks(wss) {
  retryIntervalId = setInterval(() => {
    for (const [messageId, pending] of pendingAcks.entries()) {
      const { message, receiverId, retries } = pending;

      if (retries > 3) {
        console.warn(`❌ No ACK for message ${messageId}, giving up.`);
        pendingAcks.delete(messageId);
        continue;
      }

      console.log(`🔁 Retrying message ${messageId} to user ${receiverId}`);
      broadcastToUser(wss, receiverId, {
        type: "newPrivateMessage",
        payload: {
          conversationId: message.conversation_id,
          message,
        },
      });

      pending.retries += 1;
    }
  }, 5000);
}

function stopRetryingAcks() {
  if (retryIntervalId) {
    clearInterval(retryIntervalId);
    retryIntervalId = null;
  }
}

async function deliverOfflineMessages(wss, ws, userId) {
  pendingAcks.forEach((pending, messageId) => {
    if (pending.receiverId === userId) {
      if (ws.readyState === 1) {
        ws.send(
          JSON.stringify({
            type: "newPrivateMessage",
            payload: {
              conversationId: pending.message.conversation_id,
              message: pending.message,
            },
          })
        );
        console.log(`🚚 Delivered pending message ${messageId} to ${userId}`);
      }
    }
  });
}

module.exports = {
  broadcastToUser,
  setupRedisSubscriber,
  deliverOfflineMessages,
  trackPendingAck,
  startRetryingAcks,
  stopRetryingAcks,
};
