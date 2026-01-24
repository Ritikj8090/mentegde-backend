const db = require("../config/db");

const chatRepository = {
  getUserRole: async (userId) => {
    const mentorRes = await db.query(
      "SELECT id FROM mentedge.mentors WHERE id = $1",
      [userId]
    );
    if (mentorRes.rowCount > 0) {
      return "mentor";
    }

    const userRes = await db.query(
      "SELECT id FROM mentedge.users WHERE id = $1",
      [userId]
    );
    if (userRes.rowCount > 0) {
      return "user";
    }

    return null;
  },

  getConversationBetweenUsers: async (user1, user2, role1, role2) => {
    if (role1 && role2) {
      const result = await db.query(
        `
        SELECT *
        FROM mentedge.chat_conversations
        WHERE (user1_id = $1 AND user1_role = $3 AND user2_id = $2 AND user2_role = $4)
           OR (user1_id = $2 AND user1_role = $4 AND user2_id = $1 AND user2_role = $3)
        LIMIT 1
        `,
        [user1, user2, role1, role2]
      );
      return result.rows[0];
    }

    const result = await db.query(
      `
      SELECT *
      FROM mentedge.chat_conversations
      WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
      LIMIT 1
      `,
      [user1, user2]
    );
    return result.rows[0];
  },

  getConversationById: async (conversationId) => {
    const result = await db.query(
      "SELECT * FROM mentedge.chat_conversations WHERE id = $1",
      [conversationId]
    );
    return result.rows[0];
  },

  createConversation: async (user1, user2, role1, role2) => {
    const result = await db.query(
      `
      INSERT INTO mentedge.chat_conversations (user1_id, user1_role, user2_id, user2_role)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [user1, role1, user2, role2]
    );
    return result.rows[0];
  },

  updateConversationLastMessage: async (conversationId, message) => {
    const result = await db.query(
      `
      UPDATE mentedge.chat_conversations
      SET last_message = $2, last_message_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [conversationId, message]
    );
    return result.rows[0];
  },

  saveMessage: async ({ conversationId, senderId, senderRole, message }) => {
    const result = await db.query(
      `
      INSERT INTO mentedge.chat_messages (conversation_id, sender_id, sender_role, message)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [conversationId, senderId, senderRole, message]
    );
    return result.rows[0];
  },

  saveMessageFiles: async ({ messageId, files }) => {
    if (!files || files.length === 0) {
      return [];
    }

    const fileUrls = files.map((file) => file.path);
    const fileNames = files.map((file) => file.originalname || file.filename);
    const fileTypes = files.map((file) => file.mimetype);
    const fileSizes = files.map((file) => file.size || null);

    const result = await db.query(
      `
      INSERT INTO mentedge.chat_message_files (
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
      [messageId, fileUrls, fileNames, fileTypes, fileSizes]
    );
    return result.rows;
  },

  getUserConversations: async (userId, userRole) => {
    if (userRole) {
      const result = await db.query(
        `
        SELECT
          c.id AS conversation_id,
          c.user1_id,
          c.user1_role,
          c.user2_id,
          c.user2_role,
          COALESCE(u1.full_name, m1.full_name) AS user1_name,
          COALESCE(u1.avatar, m1.avatar) AS user1_avatar,
          COALESCE(u2.full_name, m2.full_name) AS user2_name,
          COALESCE(u2.avatar, m2.avatar) AS user2_avatar,
          c.last_message,
          c.last_message_at,
          c.updated_at
        FROM mentedge.chat_conversations c
        LEFT JOIN mentedge.users u1
          ON c.user1_role = 'user' AND u1.id = c.user1_id
        LEFT JOIN mentedge.mentors m1
          ON c.user1_role = 'mentor' AND m1.id = c.user1_id
        LEFT JOIN mentedge.users u2
          ON c.user2_role = 'user' AND u2.id = c.user2_id
        LEFT JOIN mentedge.mentors m2
          ON c.user2_role = 'mentor' AND m2.id = c.user2_id
        WHERE (c.user1_id = $1 AND c.user1_role = $2)
           OR (c.user2_id = $1 AND c.user2_role = $2)
        ORDER BY c.updated_at DESC
        `,
        [userId, userRole]
      );
      return result.rows;
    }

    const result = await db.query(
      `
      SELECT
        c.id AS conversation_id,
        c.user1_id,
        c.user1_role,
        c.user2_id,
        c.user2_role,
        COALESCE(u1.full_name, m1.full_name) AS user1_name,
        COALESCE(u1.avatar, m1.avatar) AS user1_avatar,
        COALESCE(u2.full_name, m2.full_name) AS user2_name,
        COALESCE(u2.avatar, m2.avatar) AS user2_avatar,
        c.last_message,
        c.last_message_at,
        c.updated_at
      FROM mentedge.chat_conversations c
      LEFT JOIN mentedge.users u1
        ON c.user1_role = 'user' AND u1.id = c.user1_id
      LEFT JOIN mentedge.mentors m1
        ON c.user1_role = 'mentor' AND m1.id = c.user1_id
      LEFT JOIN mentedge.users u2
        ON c.user2_role = 'user' AND u2.id = c.user2_id
      LEFT JOIN mentedge.mentors m2
        ON c.user2_role = 'mentor' AND m2.id = c.user2_id
      WHERE c.user1_id = $1 OR c.user2_id = $1
      ORDER BY c.updated_at DESC
      `,
      [userId]
    );
    return result.rows;
  },

  getMessagesByConversationId: async (conversationId, limit = 50, offset = 0) => {
    const result = await db.query(
      `
      SELECT
        m.*,
        COALESCE(u.full_name, mn.full_name) AS sender_name,
        COALESCE(u.avatar, mn.avatar) AS sender_avatar,
        COALESCE(f.files, '[]'::json) AS files
      FROM mentedge.chat_messages m
      LEFT JOIN LATERAL (
        SELECT *
        FROM mentedge.users u
        WHERE m.sender_role = 'user' AND u.id = m.sender_id
      ) u ON true
      LEFT JOIN LATERAL (
        SELECT *
        FROM mentedge.mentors mn
        WHERE m.sender_role = 'mentor' AND mn.id = m.sender_id
      ) mn ON true
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
        FROM mentedge.chat_message_files f
        WHERE f.message_id = m.id
      ) f ON true
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
      LIMIT $2 OFFSET $3
      `,
      [conversationId, limit, offset]
    );
    return result.rows;
  },

  markMessagesDelivered: async (messageIds) => {
    if (!messageIds || messageIds.length === 0) {
      return [];
    }
    const result = await db.query(
      `
      UPDATE mentedge.chat_messages
      SET status = 'delivered',
          delivered_at = COALESCE(delivered_at, NOW()),
          updated_at = NOW()
      WHERE id = ANY($1::uuid[])
      RETURNING *
      `,
      [messageIds]
    );
    return result.rows;
  },

  markMessagesRead: async (messageIds) => {
    if (!messageIds || messageIds.length === 0) {
      return [];
    }
    const result = await db.query(
      `
      UPDATE mentedge.chat_messages
      SET status = 'read',
          read_at = COALESCE(read_at, NOW()),
          updated_at = NOW()
      WHERE id = ANY($1::uuid[])
      RETURNING *
      `,
      [messageIds]
    );
    return result.rows;
  },
};

module.exports = chatRepository;
