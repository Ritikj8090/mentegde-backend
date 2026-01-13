const db = require("../config/db");
const queries = require("../utils/queries");
const client = require("../config/redis");
const authRepository = require("../Repository/authRepository");

const sessionRepository = {
  createSession: async (req, res) => {
    try {
      const reqModel = req.body;
      const parameters = [
        null, // p_json_result (OUT)
        reqModel.mentor_id || null,
        reqModel.title || null,
        reqModel.description || null,
        reqModel.topic || null,
        reqModel.duration || null,
        reqModel.max_participants || null,
        reqModel.format || null,
        reqModel.prerequisites || null,
        reqModel.materials || null,
        reqModel.skill_level || null,
        reqModel.session_type || null,
        reqModel.start_time || null,
        reqModel.end_time || null,
      ];

      const result = await db.query({
        text: queries.createSession,
        values: parameters,
      });

      const responseData = result.rows[0]?.p_json_result;
      console.log("Database response:", responseData);

      if (responseData.resultStatus === "S") {
        const sessionId = responseData.resultContent.sessionId;

        // Verify client is connected before using it
        if (!client.isOpen) {
          console.warn("Redis client not connected, reconnecting...");
          await client.connect();
        }

        // Cache the session data
        // ⏳ Parse session duration to TTL (e.g., "00:45:00" -> 2700 seconds)
        const rawDuration = reqModel.duration || "01:00:00";
        const durationStr =
          typeof rawDuration === "string" ? rawDuration : String(rawDuration);
        const [hh, mm, ss] = durationStr.split(":").map(Number);

        const ttlSeconds = hh * 3600 + mm * 60 + ss || 3600; // fallback to 1 hour

        if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
          throw new Error("Invalid TTL calculated from duration");
        }

        await client.setEx(
          `session:${sessionId}`,
          ttlSeconds,
          JSON.stringify(responseData.resultContent)
        );

        // // Update mentor's live status
        // const mentorId = reqModel.mentor_id;
        // // await authRepository.updateMentorLiveStatus(mentorId, true);

        return {
          ...responseData,
          ttlSeconds, // ✅ Return it here
        };
      } else {
        console.log("Database failed with:", responseData);
        return responseData;
      }
    } catch (error) {
      console.error("Error creating session:", error);
      return {
        resultStatus: "F",
        resultMessage: error.message,
        resultContent: null,
      };
    }
  },

  fetchSession: async (req) => {
    try {
      const reqModel = req.body;
      const sessionId = reqModel.session_id;
      let responseData;

      if (sessionId) {
        const cached = await client.get(`session:${sessionId}`);
        if (cached) {
          const cachedData = JSON.parse(cached);
          // If cache has full data, return it; otherwise, fetch from DB
          if (cachedData.title) {
            // Check if full data exists
            responseData = {
              resultStatus: "S",
              resultContent: cachedData,
              resultMessage: "Session fetched from cache",
            };
            return responseData;
          }
        }
      }

      const result = await db.query({
        text: "SELECT * FROM mentor.sessions WHERE id = $1",
        values: [sessionId],
      });

      if (result.rows.length === 0) throw new Error("Session not found");

      responseData = {
        resultStatus: "S",
        resultContent: result.rows[0],
        resultMessage: "Session fetched from database",
      };

      if (sessionId) {
        await client.setEx(
          `session:${sessionId}`,
          7200,
          JSON.stringify(responseData.resultContent)
        );
      }
      return responseData;
    } catch (error) {
      console.error("Error fetching session:", error);
      throw new Error("Internal Server error");
    }
  },

  getLiveParticipantCountRepo: async (sessionId) => {
    const result = await db.query(
      `SELECT u.id, u.username AS name, u.role
      FROM mentor.session_participants sp
      JOIN mentor.users u ON u.id = sp.user_id
      WHERE sp.session_id = $1 AND sp.left_at IS NULL`,
      [sessionId]
    );
    return result.rows;
  },

  addParticipant: async (sessionId, userId) => {
    const query = `
      INSERT INTO mentor.session_participants (session_id, user_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `;
    await db.query(query, [sessionId, userId]);
  },

  removeParticipant: async (sessionId, userId) => {
    const query = `
      UPDATE mentor.session_participants
      SET left_at = NOW()
      WHERE session_id = $1 AND user_id = $2 AND left_at IS NULL
    `;
    await db.query(query, [sessionId, userId]);
  },
};

module.exports = sessionRepository;
