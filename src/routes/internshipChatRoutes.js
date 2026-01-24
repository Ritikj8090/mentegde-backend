const express = require("express");
const { protect } = require("../middleware/auth.js");
const upload = require("../middleware/upload");
const {
  listInternshipChannels,
  listChannelMessages,
  sendChannelMessage,
} = require("../controller/internshipChatController.js");

const router = express.Router({ mergeParams: true });

router.get("/:internshipId/chat/channels", protect, listInternshipChannels);
router.get(
  "/:internshipId/chat/channels/:channelId/messages",
  protect,
  listChannelMessages
);
router.post(
  "/:internshipId/chat/channels/:channelId/messages",
  protect,
  upload.array("chat_files", 10),
  sendChannelMessage
);

module.exports = router;
