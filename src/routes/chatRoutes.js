const express = require("express");
const { protect } = require("../middleware/auth.js");
const upload = require("../middleware/upload");
const {
  createConversation,
  listConversations,
  getConversation,
  getMessages,
  sendMessage,
} = require("../controller/chatController.js");

const router = express.Router();

router.post("/conversations", protect, createConversation);
router.get("/conversations", protect, listConversations);
router.get("/conversations/:conversationId", protect, getConversation);
router.get("/conversations/:conversationId/messages", protect, getMessages);
router.post(
  "/conversations/:conversationId/messages",
  protect,
  upload.array("chat_files", 10),
  sendMessage
);

module.exports = router;
