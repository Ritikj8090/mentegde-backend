const redisClient = require("../config/redis");
const chatRepository = require("../Repository/chatRepository");

const createConversation = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { participant_id, participant_role } = req.body;

    if (!userId || !userRole) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!participant_id || !participant_role) {
      return res
        .status(400)
        .json({ message: "participant_id and participant_role are required" });
    }

    if (!["user", "mentor"].includes(participant_role)) {
      return res.status(400).json({ message: "Invalid participant_role" });
    }

    if (participant_id === userId && participant_role === userRole) {
      return res
        .status(400)
        .json({ message: "Cannot create conversation with yourself" });
    }

    let conversation = await chatRepository.getConversationBetweenUsers(
      userId,
      participant_id,
      userRole,
      participant_role
    );

    if (!conversation) {
      conversation = await chatRepository.createConversation(
        userId,
        participant_id,
        userRole,
        participant_role
      );
    }

    return res.status(201).json({ conversation });
  } catch (err) {
    console.error("createConversation error:", err);
    return res.status(500).json({ message: "Failed to create conversation" });
  }
};

const listConversations = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId || !userRole) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const conversations = await chatRepository.getUserConversations(
      userId,
      userRole
    );
    return res.status(200).json({ conversations });
  } catch (err) {
    console.error("listConversations error:", err);
    return res.status(500).json({ message: "Failed to fetch conversations" });
  }
};

const getConversation = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { conversationId } = req.params;

    if (!userId || !userRole) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!conversationId) {
      return res.status(400).json({ message: "conversationId is required" });
    }

    const conversation = await chatRepository.getConversationById(
      conversationId
    );

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const isParticipant =
      (conversation.user1_id === userId &&
        conversation.user1_role === userRole) ||
      (conversation.user2_id === userId &&
        conversation.user2_role === userRole);

    if (!isParticipant) {
      return res.status(403).json({ message: "Forbidden" });
    }

    return res.status(200).json({ conversation });
  } catch (err) {
    console.error("getConversation error:", err);
    return res.status(500).json({ message: "Failed to fetch conversation" });
  }
};

const getMessages = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { conversationId } = req.params;
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;

    if (!userId || !userRole) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!conversationId) {
      return res.status(400).json({ message: "conversationId is required" });
    }

    const conversation = await chatRepository.getConversationById(
      conversationId
    );
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const isParticipant =
      (conversation.user1_id === userId &&
        conversation.user1_role === userRole) ||
      (conversation.user2_id === userId &&
        conversation.user2_role === userRole);

    if (!isParticipant) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const messages = await chatRepository.getMessagesByConversationId(
      conversationId,
      safeLimit,
      safeOffset
    );

    return res.status(200).json({ messages });
  } catch (err) {
    console.error("getMessages error:", err);
    return res.status(500).json({ message: "Failed to fetch messages" });
  }
};

const sendMessage = async (req, res) => {
  try {
    const senderId = req.user?.id;
    const senderRole = req.user?.role;
    const { conversationId } = req.params;
    const { text } = req.body;
    const files = Array.isArray(req.files) ? req.files : [];

    if (!senderId || !senderRole) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!conversationId) {
      return res.status(400).json({ message: "conversationId is required" });
    }

    if ((!text || !String(text).trim()) && files.length === 0) {
      return res.status(400).json({ message: "Provide text or files" });
    }

    const conversation = await chatRepository.getConversationById(
      conversationId
    );
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const isParticipant =
      (conversation.user1_id === senderId &&
        conversation.user1_role === senderRole) ||
      (conversation.user2_id === senderId &&
        conversation.user2_role === senderRole);

    if (!isParticipant) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const savedMessage = await chatRepository.saveMessage({
      conversationId,
      senderId,
      senderRole,
      message: text ?? null,
    });

    await chatRepository.updateConversationLastMessage(
      conversationId,
      text ?? null
    );

    const savedFiles = await chatRepository.saveMessageFiles({
      messageId: savedMessage.id,
      files,
    });

    const messagePayload = {
      ...savedMessage,
      files: savedFiles,
    };

    const receiverId =
      conversation.user1_id === senderId &&
      conversation.user1_role === senderRole
        ? conversation.user2_id
        : conversation.user1_id;

    await redisClient.publish(
      "chat_realtime",
      JSON.stringify({
        receiverId,
        payload: {
          type: "newPrivateMessage",
          payload: {
            conversationId,
            message: messagePayload,
          },
        },
      })
    );

    return res.status(201).json({ message: messagePayload });
  } catch (err) {
    console.error("sendMessage error:", err);
    return res.status(500).json({ message: "Failed to send message" });
  }
};

module.exports = {
  createConversation,
  listConversations,
  getConversation,
  getMessages,
  sendMessage,
};
