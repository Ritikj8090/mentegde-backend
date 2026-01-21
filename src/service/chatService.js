const chatRepository = require("../Repository/chatRepository");

const resolveUserRole = async (userId) => {
  const role = await chatRepository.getUserRole(userId);
  if (!role) {
    throw new Error("User not found");
  }
  return role;
};

const chatService = {
  sendMessage: async (senderId, receiverId, message, roles = {}) => {
    const senderRole = roles.senderRole || (await resolveUserRole(senderId));
    const receiverRole = roles.receiverRole || (await resolveUserRole(receiverId));

    let conversation = await chatRepository.getConversationBetweenUsers(
      senderId,
      receiverId,
      senderRole,
      receiverRole
    );

    if (!conversation) {
      conversation = await chatRepository.createConversation(
        senderId,
        receiverId,
        senderRole,
        receiverRole
      );
    }

    const savedMessage = await chatRepository.saveMessage({
      conversationId: conversation.id,
      senderId,
      senderRole,
      message,
    });

    await chatRepository.updateConversationLastMessage(
      conversation.id,
      message
    );

    return { conversation, savedMessage };
  },

  // 🚀 This can be used internally by WebSocket or other services
  getUserConversations: async (userId) => {
    return await chatRepository.getUserConversations(userId);
  },

  // ✅ Used directly by Express route
  sendMessageHandler: async (req, res) => {
    try {
      const { senderId, receiverId, message } = req.body;

      if (!senderId || !receiverId || !message) {
        return res.status(400).json({
          resultStatus: "F",
          resultMessage: "Missing required fields",
        });
      }

      const result = await chatService.sendMessage(
        senderId,
        receiverId,
        message
      );

      return res.status(200).json({
        resultStatus: "S",
        resultMessage: "Message sent successfully",
        ...result,
      });
    } catch (error) {
      console.error("Error sending message:", error);
      return res.status(500).json({
        resultStatus: "F",
        resultMessage: "Failed to send message",
      });
    }
  },

  getConversations: async (req, res) => {
    try {
      const userId = req.user.id; // ✅ We use authenticated user
      const userRole = req.user.role;
      const conversations = await chatRepository.getUserConversations(
        userId,
        userRole
      );

      return res.status(200).json({
        resultStatus: "S",
        resultMessage: "Conversations fetched successfully",
        resultContent: conversations,
      });
    } catch (error) {
      console.error("Error fetching conversations:", error);
      return res.status(500).json({
        resultStatus: "F",
        resultMessage: "Failed to fetch conversations",
      });
    }
  },

  getMessages: async (req, res) => {
    try {
      const { conversationId } = req.body;

      if (!conversationId) {
        return res.status(400).json({
          resultStatus: "F",
          resultMessage: "Conversation ID is required",
        });
      }

      const messages = await chatRepository.getMessagesByConversationId(
        conversationId
      );

      return res.status(200).json({
        resultStatus: "S",
        resultMessage: "Messages fetched successfully",
        resultContent: messages,
      });
    } catch (error) {
      console.error("Error fetching messages:", error);
      return res.status(500).json({
        resultStatus: "F",
        resultMessage: "Failed to fetch messages",
      });
    }
  },

  getMessagesByConversationId: async (
    conversationId,
    limit = 50,
    offset = 0
  ) => {
    return await chatRepository.getMessagesByConversationId(
      conversationId,
      limit,
      offset
    );
  },

  initiateConversation: async (senderId, receiverId) => {
    const existingConversation =
      await chatRepository.getConversationBetweenUsers(senderId, receiverId);

    if (existingConversation) {
      return existingConversation;
    }

    const newConversation = await chatRepository.createConversation(
      senderId,
      receiverId
    );
    return newConversation;
  },

  initiateConversationHandler: async (req, res) => {
    try {
      const { senderId, receiverId } = req.body;

      if (!senderId || !receiverId) {
        return res.status(400).json({
          resultStatus: "F",
          resultMessage: "Missing senderId or receiverId",
        });
      }

      const conversation = await chatService.initiateConversation(
        senderId,
        receiverId
      );

      return res.status(200).json({
        resultStatus: "S",
        resultMessage: "Conversation initiated successfully",
        conversation,
      });
    } catch (error) {
      console.error("Error initiating conversation:", error);
      return res.status(500).json({
        resultStatus: "F",
        resultMessage: "Failed to initiate conversation",
      });
    }
  },
};

module.exports = chatService;
