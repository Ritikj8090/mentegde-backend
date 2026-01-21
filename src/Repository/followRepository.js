const db = require("../config/db"); // Your database connection

// ✅ Create a follow request (status will be 0 = pending)
const createFollow = async (userId, mentorId) => {
  await db.query(
    `INSERT INTO mentor.follows (user_id, mentor_id, status)
     VALUES ($1, $2, 0)
     ON CONFLICT (user_id, mentor_id)
     DO UPDATE SET status = 0, updated_at = CURRENT_TIMESTAMP`,
    [userId, mentorId]
  );
};

// ✅ Find if follow already exists
const findFollow = async (userId, mentorId) => {
  const result = await db.query(
    `SELECT * FROM mentor.follows WHERE user_id = $1 AND mentor_id = $2`,
    [userId, mentorId]
  );
  return result.rows[0];
};

// ✅ Delete follow (used in unfollow)
const deleteFollow = async (userId, mentorId) => {
  await db.query(
    `DELETE FROM mentor.follows WHERE user_id = $1 AND mentor_id = $2`,
    [userId, mentorId]
  );
};

// ✅ Update status (accept = 1, reject = 2)
const updateFollowStatus = async (userId, mentorId, status) => {
  await db.query(
    `UPDATE mentor.follows SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $2 AND mentor_id = $3`,
    [status, userId, mentorId]
  );
};

// ✅ Get followers list for a mentor
const getFollowers = async (mentorId) => {
  const result = await db.query(
    `SELECT u.id, u.username, u.email
     FROM mentor.follows f
     JOIN mentor.users u ON f.user_id = u.id
     WHERE f.mentor_id = $1 AND f.status = 1`,
    [mentorId]
  );
  return result.rows;
};

const getPendingRequests = async (mentorId) => {
  const result = await db.query(
    `SELECT u.id, u.username, u.email
       FROM mentor.follows f
       JOIN mentor.users u ON f.user_id = u.id
       WHERE f.mentor_id = $1 AND f.status = 0`, // status 0 = pending
    [mentorId]
  );
  return result.rows;
};

module.exports = {
  createFollow,
  findFollow,
  deleteFollow,
  updateFollowStatus,
  getFollowers,
  getPendingRequests,
};
