const sessionRepository = require("../Repository/sessionRepository");
const { v4: uuidv4 } = require("uuid");
const client = require("../config/redis");
const authRepository = require("../Repository/authRepository");
const authService = require("./authServices");

const createSession = async (req, res) => {
  try {
    const result = await sessionRepository.createSession(req);
    if (result.resultStatus !== "S") throw new Error(result.resultMessage);

    const sessionId = result.resultContent.sessionId;
    const userId = req.body.mentor_id; // This is the user's ID (from mentor.users.id)
    const token = uuidv4();

    const tokenData = JSON.stringify({ sessionId, userId });

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

    // Store token for user/session
    await client.setEx(`webrtc:token:${token}`, result.ttlSeconds, tokenData);
    await client.setEx(
      `webrtc:live_session:${userId}`,
      result.ttlSeconds,
      JSON.stringify({ sessionId, userId })
    );

    // Set mentor is_live = true
    await authService.updateMentorLiveStatus(
      { body: { isLive: true }, user: { id: userId } },
      { status: () => ({ json: () => {} }) }
    );

    // // Push to liveMentors Redis list
    // const mentorData = JSON.stringify({
    //   user_id: userId,
    //   is_live: true,
    // });

    // await client.lPush("liveMentors", mentorData);
    await client.publish(
      "mentor:liveStatus",
      JSON.stringify({ userId, isLive: true })
    );

    res.status(200).json({
      message: "Session created successfully",
      data: { token, sessionId },
    });
  } catch (error) {
    console.error("Error creating session:", error);
    res.status(500).json({ message: error.message });
  }
};

const fetchSession = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) throw new Error("Token required");

    const tokenData = await client.get(`webrtc:token:${token}`);
    if (!tokenData) throw new Error("Invalid or expired token");

    const { sessionId } = JSON.parse(tokenData);
    req.body.session_id = sessionId;

    const result = await sessionRepository.fetchSession(req);
    res
      .status(200)
      .json({ message: "Session fetched successfully", data: result });
  } catch (error) {
    console.error("Error:", error);
    res
      .status(500)
      .json({ message: `Failed to fetch session: ${error.message}` });
  }
};

const fetchSessionByMentorService = async (mentorUserId) => {
  if (!mentorUserId) {
    throw { status: 400, message: "mentor_id is required" };
  }

  // 🔥 This now correctly uses userId to pull session
  const session = await sessionRepository.getLiveSessionByMentorId(
    mentorUserId
  );

  if (!session) {
    throw { status: 404, message: "No active session found for this mentor" };
  }

  return session;
};

const endSession = async (req, res) => {
  const userId = req.user.id;
  const token = req.body.token;

  // ✅ 1. Validate input early
  if (!token) {
    return res.status(400).json({ message: "Missing token to end session." });
  }

  try {
    // ✅ 2. Ensure Redis is connected only if not already
    if (!client.isOpen) {
      await client.connect().catch((err) => {
        console.error("Redis connection error:", err);
        throw new Error("Redis unavailable");
      });
    }

    // ✅ 3. Find active session for the mentor
    const liveSession = await sessionRepository.getLiveSessionByMentorId(
      userId
    );
    if (!liveSession) {
      return res.status(404).json({ message: "No active session to end." });
    }

    const sessionId = liveSession.id;

    // ✅ 4. Optional: update DB status (if your schema supports it)
    try {
      await sessionRepository.markSessionAsEnded?.(sessionId); // safe call if method exists
    } catch (dbErr) {
      console.warn("Failed to mark session ended in DB:", dbErr.message);
    }

    // ✅ 5. Clean up Redis keys
    await client.del(`session:${sessionId}`);
    await client.del(`webrtc:token:${token}`);
    await client.del(`webrtc:live_session:${userId}`);

    // ✅ 6. Remove from liveMentors list (O(n), switch to Set for O(1) in future)
    const existingMentors = await client.lRange("liveMentors", 0, -1);
    for (const entry of existingMentors) {
      try {
        const parsed = JSON.parse(entry);
        if (parsed.user_id === userId) {
          await client.lRem("liveMentors", 0, entry);
        }
      } catch (err) {
        console.warn("Invalid mentor entry in Redis:", entry);
      }
    }

    await authService.updateMentorLiveStatus(
      { body: { isLive: false }, user: { id: userId } },
      { status: () => ({ json: () => {} }) }
    );

    // ✅ 8. Notify WebSocket clients via Redis pub/sub
    await client.publish(
      "mentor:liveStatus",
      JSON.stringify({
        mentorId: userId,
        isLive: false,
      })
    );

    // ✅ 9. Success response
    res
      .status(200)
      .json({ message: "Session ended and cleaned up successfully" });
  } catch (error) {
    console.error("❌ Error ending session:", error);
    res
      .status(500)
      .json({ message: "Failed to end session. Try again later." });
  }
};

const getLiveParticipantCountService = async (sessionId) => {
  return await sessionRepository.getLiveParticipantCountRepo(sessionId);
};

const getLiveSessionByMentorIdService = async (mentorUserId) => {
  if (!client.isOpen) await client.connect().catch(() => {});
  const redisKey = `webrtc:live_session:${mentorUserId}`;
  const tokenData = await client.get(redisKey);
  if (!tokenData) return null;
  const { sessionId } = JSON.parse(tokenData);
  const sessionData = await client.get(`session:${sessionId}`);
  return sessionData ? JSON.parse(sessionData) : null;
};

module.exports = {
  createSession,
  fetchSession,
  fetchSessionByMentorService,
  endSession,
  getLiveParticipantCountService,
  getLiveSessionByMentorIdService,
};
