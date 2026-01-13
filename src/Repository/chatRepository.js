const db = require("../config/db");

const chatRepository = {
  getConversationBetweenUsers: async (user1, user2) => {
    const result = await db.query(
      `
      SELECT * FROM mentor.conversations
      WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
      LIMIT 1
    `,
      [user1, user2]
    );
    return result.rows[0];
  },

  createConversation: async (user1, user2) => {
    const result = await db.query(
      `
      INSERT INTO mentor.conversations (user1_id, user2_id)
      VALUES ($1, $2)
      RETURNING *
    `,
      [user1, user2]
    );
    return result.rows[0];
  },

  saveMessage: async ({ conversationId, senderId, message }) => {
    const result = await db.query(
      `
      INSERT INTO mentor.messages (conversation_id, sender_id, message)
      VALUES ($1, $2, $3)
      RETURNING *
    `,
      [conversationId, senderId, message]
    );
    return result.rows[0];
  },

  getUserConversations: async (userId) => {
    const result = await db.query(
      `
      SELECT
        c.id AS conversation_id,
        u1.id AS user1_id,
        u1.username AS user1_name,
        u2.id AS user2_id,
        u2.username AS user2_name,
        c.last_message,
        c.last_message_at
      FROM
        mentor.conversations c
      JOIN
        mentor.users u1 ON c.user1_id = u1.id
      JOIN
        mentor.users u2 ON c.user2_id = u2.id
      WHERE
        c.user1_id = $1 OR c.user2_id = $1
      ORDER BY
        c.updated_at DESC
      `,
      [userId]
    );
    return result.rows;
  },

  getMessagesByConversationId: async (conversationId, limit = 50, offset = 0) => {
    const result = await db.query(
      `
      SELECT *
      FROM mentor.messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      LIMIT $2 OFFSET $3
    `,
      [conversationId, limit, offset]
    );
    return result.rows;
  }
  
};

module.exports = chatRepository;
