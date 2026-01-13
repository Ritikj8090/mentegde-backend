const createUser = "CALL mentor.prr_create_user_list($1, $2, $3, $4, $5, $6, $7, $8)";
const findUser = "CALL mentor.prr_call_get_user_details($1, $2, $3)";
const loginUser = "SELECT id, username, email, role, is_active, password_hash FROM mentor.users WHERE email = $1";
const checkUsername = "SELECT id FROM mentor.users WHERE LOWER(username) = LOWER($1)";
const checkEmail = "SELECT id FROM mentor.users WHERE LOWER(email) = LOWER($1) LIMIT 1";
const createSession = "CALL mentor.prr_create_session($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)";
const fetchSession = "CALL mentor.prr_call_get_session_details($1, $2, $3)";

const onboardUser = "CALL mentor.prr_onboard_user($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)";

module.exports = {
  createUser,
  findUser,
  loginUser,
  checkUsername,
  checkEmail,
  createSession,
  fetchSession,
  onboardUser
};
