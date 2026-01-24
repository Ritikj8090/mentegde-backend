const redisClient = require("../config/redis");
const db = require("../config/db");
const {
  ensureChannels,
  listChannelsForInternship,
  addMemberToInternshipChannels,
} = require("../service/internshipChatService");

const canAccessInternshipChat = async (internshipId, userId, role) => {
  if (role === "mentor") {
    const result = await db.query(
      `
      SELECT 1
      FROM mentedge.internship_hosts
      WHERE internship_id = $1
        AND mentor_id = $2
        AND (
          role = 'host'
          OR (role = 'co-host' AND invite_status = 'accepted')
        )
      `,
      [internshipId, userId]
    );
    return result.rowCount > 0;
  }

  if (role === "user") {
    const result = await db.query(
      `
      SELECT 1
      FROM mentedge.internship_joined
      WHERE internship_id = $1 AND intern_id = $2
      `,
      [internshipId, userId]
    );
    return result.rowCount > 0;
  }

  return false;
};

const listInternshipChannels = async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const { internshipId } = req.params;

    if (!userId || !role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!internshipId) {
      return res.status(400).json({ message: "internshipId is required" });
    }

    const hasAccess = await canAccessInternshipChat(
      internshipId,
      userId,
      role
    );
    if (!hasAccess) {
      return res.status(403).json({ message: "Forbidden" });
    }

    await ensureChannels(db, internshipId);

    if (role === "mentor") {
      const mentorRes = await db.query(
        `
        SELECT domain
        FROM mentedge.internship_hosts
        WHERE internship_id = $1
          AND mentor_id = $2
          AND (
            role = 'host'
            OR (role = 'co-host' AND invite_status = 'accepted')
          )
        `,
        [internshipId, userId]
      );
      const domainName = mentorRes.rows[0]?.domain;
      await addMemberToInternshipChannels(
        db,
        internshipId,
        userId,
        "mentor",
        domainName
      );
    }

    if (role === "user") {
      const joinRes = await db.query(
        `
        SELECT d.domain_name
        FROM mentedge.internship_joined j
        JOIN mentedge.internship_domains d ON d.id = j.domain_id
        WHERE j.internship_id = $1 AND j.intern_id = $2
        `,
        [internshipId, userId]
      );
      const domainName = joinRes.rows[0]?.domain_name;
      await addMemberToInternshipChannels(
        db,
        internshipId,
        userId,
        "user",
        domainName
      );
    }

    const channels = await listChannelsForInternship(internshipId);
    return res.status(200).json({ channels });
  } catch (err) {
    console.error("listInternshipChannels error:", err);
    return res.status(500).json({ message: "Failed to fetch channels" });
  }
};

const listChannelMessages = async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const { internshipId, channelId } = req.params;
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;

    if (!userId || !role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!internshipId || !channelId) {
      return res
        .status(400)
        .json({ message: "internshipId and channelId are required" });
    }

    const hasAccess = await canAccessInternshipChat(
      internshipId,
      userId,
      role
    );
    if (!hasAccess) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const channelRes = await db.query(
      `
      SELECT id
      FROM mentedge.internship_chat_channels
      WHERE id = $1 AND internship_id = $2
      `,
      [channelId, internshipId]
    );
    if (channelRes.rowCount === 0) {
      return res.status(404).json({ message: "Channel not found" });
    }

    const messages = await db.query(
      `
      SELECT
        m.*,
        COALESCE(u.full_name, mn.full_name) AS sender_name,
        COALESCE(u.avatar, mn.avatar) AS sender_avatar,
        COALESCE(f.files, '[]'::json) AS files
      FROM mentedge.internship_chat_messages m
      LEFT JOIN mentedge.users u
        ON m.sender_role = 'user' AND u.id = m.sender_id
      LEFT JOIN mentedge.mentors mn
        ON m.sender_role = 'mentor' AND mn.id = m.sender_id
      LEFT JOIN LATERAL (
        SELECT json_agg(
          json_build_object(
            'id', f.id,
            'file_url', f.file_url,
            'file_name', f.file_name,
            'file_type', f.file_type,
            'file_size', f.file_size,
            'created_at', f.created_at
          )
          ORDER BY f.created_at
        ) AS files
        FROM mentedge.internship_chat_message_files f
        WHERE f.message_id = m.id
      ) f ON true
      WHERE m.channel_id = $1
      ORDER BY m.created_at ASC
      LIMIT $2 OFFSET $3
      `,
      [channelId, safeLimit, safeOffset]
    );

    return res.status(200).json({ messages: messages.rows });
  } catch (err) {
    console.error("listChannelMessages error:", err);
    return res.status(500).json({ message: "Failed to fetch messages" });
  }
};

const sendChannelMessage = async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    const { internshipId, channelId } = req.params;
    const { text } = req.body;
    const files = Array.isArray(req.files) ? req.files : [];

    if (!userId || !role) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!internshipId || !channelId) {
      return res
        .status(400)
        .json({ message: "internshipId and channelId are required" });
    }

    if ((!text || !String(text).trim()) && files.length === 0) {
      return res.status(400).json({ message: "Provide text or files" });
    }

    const hasAccess = await canAccessInternshipChat(
      internshipId,
      userId,
      role
    );
    if (!hasAccess) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const channelRes = await db.query(
      `
      SELECT id, channel_type, domain_name
      FROM mentedge.internship_chat_channels
      WHERE id = $1 AND internship_id = $2
      `,
      [channelId, internshipId]
    );
    if (channelRes.rowCount === 0) {
      return res.status(404).json({ message: "Channel not found" });
    }

    if (role === "mentor") {
      const hostRes = await db.query(
        `
        SELECT domain
        FROM mentedge.internship_hosts
        WHERE internship_id = $1
          AND mentor_id = $2
          AND (
            role = 'host'
            OR (role = 'co-host' AND invite_status = 'accepted')
          )
        `,
        [internshipId, userId]
      );
      const mentorDomain = hostRes.rows[0]?.domain;
      if (
        channelRes.rows[0].channel_type !== "general" &&
        mentorDomain !== channelRes.rows[0].domain_name
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    if (role === "user") {
      const joinRes = await db.query(
        `
        SELECT d.domain_name
        FROM mentedge.internship_joined j
        JOIN mentedge.internship_domains d ON d.id = j.domain_id
        WHERE j.internship_id = $1 AND j.intern_id = $2
        `,
        [internshipId, userId]
      );
      const domainName = joinRes.rows[0]?.domain_name;
      if (
        channelRes.rows[0].channel_type !== "general" &&
        domainName !== channelRes.rows[0].domain_name
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    const messageRes = await db.query(
      `
      INSERT INTO mentedge.internship_chat_messages (
        channel_id, sender_id, sender_role, message
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [channelId, userId, role, text ?? null]
    );

    const savedMessage = messageRes.rows[0];
    const senderRes = await db.query(
      `
      SELECT
        COALESCE(u.full_name, mn.full_name) AS sender_name,
        COALESCE(u.avatar, mn.avatar) AS sender_avatar
      FROM (SELECT $1::uuid AS id, $2::text AS role) s
      LEFT JOIN mentedge.users u
        ON s.role = 'user' AND u.id = s.id
      LEFT JOIN mentedge.mentors mn
        ON s.role = 'mentor' AND mn.id = s.id
      `,
      [userId, role]
    );
    const senderMeta = senderRes.rows[0] || {};
    let savedFiles = [];

    if (files.length > 0) {
      const fileUrls = files.map((file) => file.path);
      const fileNames = files.map((file) => file.originalname || file.filename);
      const fileTypes = files.map((file) => file.mimetype);
      const fileSizes = files.map((file) => file.size || null);

      const filesRes = await db.query(
        `
        INSERT INTO mentedge.internship_chat_message_files (
          message_id, file_url, file_name, file_type, file_size
        )
        SELECT
          $1,
          f.file_url,
          f.file_name,
          f.file_type,
          f.file_size
        FROM unnest(
          $2::text[],
          $3::text[],
          $4::text[],
          $5::int[]
        ) AS f(file_url, file_name, file_type, file_size)
        RETURNING *
        `,
        [savedMessage.id, fileUrls, fileNames, fileTypes, fileSizes]
      );
      savedFiles = filesRes.rows;
    }

    const payload = {
      type: "internshipChannelMessage",
      payload: {
        channelId,
        internshipId,
        message: { ...savedMessage, ...senderMeta, files: savedFiles },
      },
    };

    const memberRes = await db.query(
      `
      SELECT user_id
      FROM mentedge.internship_chat_members
      WHERE channel_id = $1
      `,
      [channelId]
    );

    await Promise.all(
      memberRes.rows.map((row) =>
        redisClient.publish(
          "chat_realtime",
          JSON.stringify({ receiverId: row.user_id, payload })
        )
      )
    );

    return res.status(201).json({ message: payload.payload.message });
  } catch (err) {
    console.error("sendChannelMessage error:", err);
    return res.status(500).json({ message: "Failed to send message" });
  }
};

module.exports = {
  listInternshipChannels,
  listChannelMessages,
  sendChannelMessage,
};
