const jwt = require("jsonwebtoken");
const db = require("../config/db");
const bcrypt = require("bcryptjs");
const queries = require("../utils/queries");
const client = require("../config/redis");
const { sanitizeLiveMentorEntry } = require("../utils/sanitize");
const websocketTokenService = require("../service/websocketTokenService");
const createUserTableQuery =
  require("../queries/userQueries").createUserTableQuery;

const SECRET_KEY = process.env.JWT_SECRET;

const safeJson = (value) =>
  value === undefined || value === null ? JSON.stringify([]) : JSON.stringify(value);


const authRepository = {
  createUser: async (email, full_name, password) => {
    try {
      const userExistQuery = "SELECT * FROM mentedge.users WHERE email = $1";
      const userExists = await db.query({
        text: userExistQuery,
        values: [email],
      });

      if (userExists.rowCount > 0) {
        throw new Error("User already exists");
      }

      const createUserQuery = `INSERT INTO mentedge.users (email, full_name, password) VALUES ($1, $2, $3) RETURNING id, email, full_name`;
      const hashedPassword = await bcrypt.hash(password, 10);
      const result = await db.query({
        text: createUserQuery,
        values: [email, full_name, hashedPassword],
      });

      if (result.rowCount === 0) {
        throw new Error("User creation failed");
      }

      return {
        resultStatus: "Success",
        resultContent: result.rows[0],
        resultMessage: "User created successfully",
      };
    } catch (error) {
      console.error("Error creating new user:", error.message);
      throw error; // Pass original error for better upstream handling
    }
  },

  loginUser: async (email, password) => {
    try {
      const userExistQuery = "SELECT * FROM mentedge.users WHERE email = $1";
      const result = await db.query({
        text: userExistQuery,
        values: [email],
      });

      if (result.rowCount === 0) {
        throw new Error("Invalid email or password");
      }

      const user = result.rows[0];

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) throw new Error("Invalid email or password");
      const token = jwt.sign(
        {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          avatar: user.avatar,
          role: "user",
          gender: user.gender,
        },
        SECRET_KEY,
        { expiresIn: "30d" }
      );
      const websocketToken = await websocketTokenService.generateToken(user.id);

      const { password: _, ...safeUser } = user;
      return { user: safeUser, token, websocketToken };
    } catch (error) {
      console.error("Error logging in user:", error.message);
      throw error;
    }
  },

  oboardingUser: async (req) => {
    try {
      const { id } = req.user;
      const {
        full_name,
        gender,
        date_of_birth,
        avatar,
        phone_number,
        bio,
        current_city,
        current_state,
        current_status,
        educations,
        experience,
        skills,
        languages,
        certificates,
        interests,
        resume_link,
        portfolio_link,
        linkedin_link,
        github_link,
        hear_about,
      } = req.body;
      const updateUserQuery = `UPDATE mentedge.users SET
        full_name = $2,
        gender = $3,
        date_of_birth = $4,
        avatar = $5,
        phone_number = $6,
        bio = $7,
        current_city = $8,
        current_state = $9,
        current_status = $10,
        resume_link = $11,
        portfolio_link = $12,
        linkedin_link = $13,
        github_link = $14,
        hear_about = $15,
        educations = $16,
        experience = $17,
        skills = $18,
        languages = $19,
        certificates = $20,
        interests = $21
        WHERE id = $1
        RETURNING *
      `;

      const result = await db.query({
        text: updateUserQuery,
        values: [
          id,
          full_name,
          gender,
          date_of_birth,
          avatar,
          phone_number,
          bio,
          current_city,
          current_state,
          current_status,
          resume_link,
          portfolio_link,
          linkedin_link,
          github_link,
          hear_about,
          safeJson(educations),
          safeJson(experience),
          safeJson(skills),
          safeJson(languages),
          safeJson(certificates),
          safeJson(interests),
        ],
      });

      if (!result.rows[0]) {
        throw new Error("User not found or no changes applied");
      }

      const token = jwt.sign(
        {
          id: result.rows[0].id,
          full_name: result.rows[0].full_name,
          email: result.rows[0].email,
          avatar: result.rows[0].avatar,
          role: result.rows[0].role,
          gender: result.rows[0].gender,
        },
        SECRET_KEY,
        { expiresIn: "30d" }
      );
      const websocketToken = await websocketTokenService.generateToken(
        result.rows[0].id
      );

      return {
        resultStatus: "Success",
        resultContent: result.rows[0],
        resultMessage: "User onboarded successfully",
        token,
        websocketToken,
      };
    } catch (error) {
      console.error("Error updating user:", error.message);
      throw error;
    }
  },

  findUser: async ({ id }) => {
    try {
      const findUserQuery = `SELECT * FROM mentedge.users WHERE id = $1`;
      const findUserEducationQuery = `SELECT * FROM mentedge.educations WHERE owner_id = $1 AND owner_type = 'user'`;
      const findUserExperienceQuery = `SELECT * FROM mentedge.experiences WHERE owner_id = $1 AND owner_type = 'user'`;
      const findUserSkillQuery = `SELECT * FROM mentedge.skills WHERE owner_id = $1 AND owner_type = 'user'`;
      const findUserLanguageQuery = `SELECT * FROM mentedge.languages WHERE owner_id = $1 AND owner_type = 'user'`;
      const findUserCertificateQuery = `SELECT * FROM mentedge.certificates WHERE owner_id = $1 AND owner_type = 'user'`;
      const findUserInterestQuery = `SELECT * FROM mentedge.interests WHERE owner_id = $1 AND owner_type = 'user'`;

      const result = await db.query({
        text: findUserQuery,
        values: [id],
      });

      if (result.rowCount === 0) {
        throw new Error("User not found");
      }

      const educations = await db.query({
        text: findUserEducationQuery,
        values: [id],
      });
      const experiences = await db.query({
        text: findUserExperienceQuery,
        values: [id],
      });
      const skills = await db.query({
        text: findUserSkillQuery,
        values: [id],
      });
      const languages = await db.query({
        text: findUserLanguageQuery,
        values: [id],
      });
      const certificates = await db.query({
        text: findUserCertificateQuery,
        values: [id],
      });
      const interests = await db.query({
        text: findUserInterestQuery,
        values: [id],
      });

      result.rows[0].educations = educations.rows;
      result.rows[0].experiences = experiences.rows;
      result.rows[0].skills = skills.rows;
      result.rows[0].languages = languages.rows;
      result.rows[0].certificates = certificates.rows;
      result.rows[0].interests = interests.rows;

      const { password: _, ...safeUser } = result.rows[0];
      return { dbUser: safeUser };
    } catch (error) {
      console.error("Error finding user:", error.message);
      throw error;
    }
  },

  createMentor: async (email, full_name, password) => {
    try {
      const mentorExistQuery =
        "SELECT * FROM mentedge.mentors WHERE email = $1";
      const mentorExists = await db.query({
        text: mentorExistQuery,
        values: [email],
      });

      if (mentorExists.rowCount > 0) {
        throw new Error("Mentor already exists");
      }

      const createMentorQuery = `INSERT INTO mentedge.mentors (email, full_name, password) VALUES ($1, $2, $3) RETURNING id, email, full_name, role`;
      const hashedPassword = await bcrypt.hash(password, 10);
      const result = await db.query({
        text: createMentorQuery,
        values: [email, full_name, hashedPassword],
      });

      if (result.rowCount === 0) {
        throw new Error("Mentor creation failed");
      }

      return {
        resultStatus: "Success",
        resultContent: result.rows[0],
        resultMessage: "Mentor created successfully",
      };
    } catch (error) {
      console.error("Error creating new user:", error.message);
      throw error; // Pass original error for better upstream handling
    }
  },

  loginMentor: async (email, password) => {
    try {
      const mentorExistQuery =
        "SELECT * FROM mentedge.mentors WHERE email = $1";
      const result = await db.query({
        text: mentorExistQuery,
        values: [email],
      });

      if (result.rowCount === 0) {
        throw new Error("Invalid email or password");
      }

      const user = result.rows[0];

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) throw new Error("Invalid email or password");
      const token = jwt.sign(
        {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          avatar: user.avatar,
          role: "mentor",
          gender: user.gender,
        },
        SECRET_KEY,
        { expiresIn: "30d" }
      );
      const websocketToken = await websocketTokenService.generateToken(user.id);

      const { password: _, ...safeUser } = user;
      return { user: safeUser, token, websocketToken };
    } catch (error) {
      console.error("Error logging in mentor:", error.message);
      throw error;
    }
  },

  oboardingMentor: async (req) => {
    try {
      const { id } = req.user;
      const {
        full_name,
        gender,
        date_of_birth,
        avatar,
        phone_number,
        bio,
        current_city,
        current_state,
        current_status,
        educations,
        experience,
        skills,
        languages,
        certificates,
        interests,
        resume_link,
        portfolio_link,
        linkedin_link,
        github_link,
        hear_about,
      } = req.body;
      const updateUserQuery = `UPDATE mentedge.mentors SET
        full_name = $2,
        gender = $3,
        date_of_birth = $4,
        avatar = $5,
        phone_number = $6,
        bio = $7,
        current_city = $8,
        current_state = $9,
        current_status = $10,
        resume_link = $11,
        portfolio_link = $12,
        linkedin_link = $13,
        github_link = $14,
        hear_about = $15,
        educations = $16,
        experience = $17,
        skills = $18,
        languages = $19,
        certificates = $20,
        interests = $21
        WHERE id = $1
        RETURNING *
      `;

      const result = await db.query({
        text: updateUserQuery,
        values: [
          id,
          full_name,
          gender,
          date_of_birth,
          avatar,
          phone_number,
          bio,
          current_city,
          current_state,
          current_status,
          resume_link,
          portfolio_link,
          linkedin_link,
          github_link,
          hear_about,
          safeJson(educations),
          safeJson(experience),
          safeJson(skills),
          safeJson(languages),
          safeJson(certificates),
          safeJson(interests),
        ],
      });

      if (!result.rows[0]) {
        throw new Error("Mentor not found or no changes applied");
      }

      const token = jwt.sign(
        {
          id: result.rows[0].id,
          full_name: result.rows[0].full_name,
          email: result.rows[0].email,
          avatar: result.rows[0].avatar,
          role: result.rows[0].role,
          gender: result.rows[0].gender,
        },
        SECRET_KEY,
        { expiresIn: "30d" }
      );
      const websocketToken = await websocketTokenService.generateToken(
        result.rows[0].id
      );

      return {
        resultStatus: "Success",
        resultContent: result.rows[0],
        resultMessage: "Mentor onboarded successfully",
        token,
        websocketToken,
      };
    } catch (error) {
      console.error("Error updating mentor:", error.message);
      throw error;
    }
  },

  findMentor: async ({ id, email, full_name }) => {
    try {
      console.log(full_name, email, id);
      const findMentorQuery = `SELECT * FROM mentedge.mentors WHERE id = $1 OR email = $2 OR full_name ILIKE '%' || $3 || '%'`;
      const findMentorEducationQuery = `SELECT * FROM mentedge.educations WHERE owner_id = $1 AND owner_type = 'mentor'`;
      const findMentorExperienceQuery = `SELECT * FROM mentedge.experiences WHERE owner_id = $1 AND owner_type = 'mentor'`;
      const findMentorSkillQuery = `SELECT * FROM mentedge.skills WHERE owner_id = $1 AND owner_type = 'mentor'`;
      const findMentorLanguageQuery = `SELECT * FROM mentedge.languages WHERE owner_id = $1 AND owner_type = 'mentor'`;
      const findMentorCertificateQuery = `SELECT * FROM mentedge.certificates WHERE owner_id = $1 AND owner_type = 'mentor'`;
      const findMentorInterestQuery = `SELECT * FROM mentedge.interests WHERE owner_id = $1 AND owner_type = 'mentor'`;

      const result = await db.query({
        text: findMentorQuery,
        values: [id, email, full_name],
      });

      if (result.rowCount === 0) {
        throw new Error("Mentor not found");
      }

      const educations = await db.query({
        text: findMentorEducationQuery,
        values: [result.rows[0].id],
      });
      const experiences = await db.query({
        text: findMentorExperienceQuery,
        values: [result.rows[0].id],
      });
      const skills = await db.query({
        text: findMentorSkillQuery,
        values: [result.rows[0].id],
      });
      const languages = await db.query({
        text: findMentorLanguageQuery,
        values: [result.rows[0].id],
      });
      const certificates = await db.query({
        text: findMentorCertificateQuery,
        values: [result.rows[0].id],
      });
      const interests = await db.query({
        text: findMentorInterestQuery,
        values: [result.rows[0].id],
      });

      result.rows[0].educations = educations.rows;
      result.rows[0].experiences = experiences.rows;
      result.rows[0].skills = skills.rows;
      result.rows[0].languages = languages.rows;
      result.rows[0].certificates = certificates.rows;
      result.rows[0].interests = interests.rows;

      const { password: _, ...safeUser } = result.rows[0];
      return { dbUser: safeUser };
    } catch (error) {
      console.error("Error finding mentor:", error.message);
      throw error;
    }
  },

  findMentors: async ({ id, email, full_name, excludeId }) => {
    try {
      console.log(full_name, email, id);
      const findMentorQuery = `
        SELECT *
        FROM mentedge.mentors
        WHERE (id = $1 OR email = $2 OR full_name ILIKE '%' || $3 || '%')
          AND ($4::uuid IS NULL OR id <> $4)
      `;

      const result = await db.query({
        text: findMentorQuery,
        values: [id ?? null, email ?? null, full_name ?? null, excludeId ?? null],
      });

      if (result.rowCount === 0) {
        throw new Error("Mentor not found");
      }

      const safeUsers = result.rows.map(({ password, ...rest }) => rest);

      return { dbUser: safeUsers };
    } catch (error) {
      console.error("Error finding mentor:", error.message);
      throw error;
    }
  },

  findOrCreateGoogleUser: async (
    profile,
    accessToken,
    refreshToken,
    expiresIn,
    role = "user"
  ) => {
    try {
      const existingUser = await authRepository.findUser({
        email: profile.emails[0].value,
      });
      if (existingUser && existingUser.resultContent) {
        await db.query({
          text: "INSERT INTO mentor.oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scope) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, provider) DO UPDATE SET access_token = $3, refresh_token = $4, expires_at = $5",
          values: [
            existingUser.resultContent.id,
            "google",
            accessToken,
            refreshToken,
            new Date(Date.now() + expiresIn * 1000),
            "profile email",
          ],
        });
        return existingUser.resultContent;
      }

      const newUserData = {
        email: profile.emails[0].value,
        username: profile.displayName || profile.id,
        google_id: profile.id,
        display_name: profile.displayName,
        role: role,
      };
      const newUser = await authRepository.createUser(newUserData);
      const createdUser = newUser.resultContent;

      await db.query({
        text: "INSERT INTO mentor.oauth_tokens (user_id, provider, access_token, refresh_token, expires_at, scope) VALUES ($1, $2, $3, $4, $5, $6)",
        values: [
          createdUser.id,
          "google",
          accessToken,
          refreshToken,
          new Date(Date.now() + expiresIn * 1000),
          "profile email",
        ],
      });

      return createdUser;
    } catch (error) {
      console.error("Error in findOrCreateGoogleUser:", error.message);
      throw error;
    }
  },

  checkUsernameAvailability: async (username) => {
    try {
      const result = await db.query({
        text: queries.checkUsername,
        values: [username.toLowerCase()],
      });

      return result.rowCount === 0; // true = available
    } catch (error) {
      console.error("Error checking username availability:", error.message);
      throw error;
    }
  },

  checkEmailAvailability: async (email) => {
    try {
      const result = await db.query({
        text: queries.checkEmail,
        values: [email],
      });

      return result.rowCount === 0; // true = available
    } catch (error) {
      console.error("Error checking email availability:", error.message);
      throw error;
    }
  },

  onboardUser: async (req, res) => {
    try {
      const reqModel = req.body;

      const parameters = [
        null,
        req.user.id,
        // reqModel.flag || "N",
        reqModel.role || null,
        reqModel.firstName || null,
        reqModel.lastName || null,
        reqModel.phone || null,
        reqModel.dob || null,
        reqModel.location || null,
        reqModel.avatar || null,
        reqModel.bio || null,
        // reqModel.expertise || [],
        // reqModel.availability || {},
        reqModel.currRole || null,
        reqModel.careerGoals || null,
        reqModel.skillsToImprove || null,
        reqModel.mentorPreferences || null,
        reqModel.additionalInfo || null,
        JSON.stringify(reqModel.experiences || []),
        JSON.stringify(reqModel.educations || []),
        JSON.stringify(reqModel.socialLinks || []),
      ];

      const result = await db.query({
        text: queries.onboardUser,
        values: parameters,
      });

      const responseData = result.rows[0]?.p_json_result;
      console.log(responseData);
      return responseData;
    } catch (error) {
      console.error("Error onboarding user:", error);
      return res.status(500).json({ message: "Internal Server error" });
    }
  },

  getMentors: async () => {
    try {
      const result = await db.query(`
        SELECT m.id AS id, m.user_id, m.is_live, u.username, u.email
        FROM mentor.mentors m
        JOIN mentor.users u ON m.user_id = u.id
        WHERE u.role = 'mentor'
      `);
      return result.rows;
    } catch (error) {
      console.error("Error fetching mentors:", error.message);
      throw error;
    }
  },

  getLiveMentors: async () => {
    try {
      const raw = await client.lRange("liveMentors", 0, -1);
      const validMentors = [];

      for (const entry of raw) {
        const parsed = sanitizeLiveMentorEntry(entry);
        if (!parsed?.user_id) continue;

        const exists = await client.exists(`mentor:${parsed.user_id}`);
        if (!exists) {
          await client.lRem("liveMentors", 0, entry); // Remove stale
          continue;
        }

        validMentors.push(parsed);
      }

      return validMentors;
    } catch (err) {
      console.error("Error in getLiveMentors (Redis only):", err.message);
      return [];
    }
  },

  getMentorProfile: async (userId) => {
    try {
      const userResult = await db.query(
        `
      SELECT u.id, u.username, u.email, u.dob, u.phone, u.location,
             m.bio, m.rating, m.expertise
      FROM mentor.users u
      JOIN mentor.mentors m ON m.user_id = u.id
      WHERE u.id = $1
    `,
        [userId]
      );

      if (userResult.rows.length === 0) return null;

      const user = userResult.rows[0];

      const [educations, experiences, socialLinks] = await Promise.all([
        db.query(
          `SELECT degree, institution, start_year, end_year, description, field_of_study FROM mentor.educations WHERE user_id = $1`,
          [userId]
        ),
        db.query(
          `SELECT position, company, start_date, end_date, currently_working, description FROM mentor.experiences WHERE user_id = $1`,
          [userId]
        ),
        db.query(
          `SELECT platform, link FROM mentor.social_links WHERE user_id = $1`,
          [userId]
        ),
      ]);

      return {
        ...user,
        educations: educations.rows,
        experiences: experiences.rows,
        socialLinks: socialLinks.rows,
      };
    } catch (err) {
      console.error("Error in getMentorProfile:", err.message);
      throw err;
    }
  },
};

module.exports = authRepository;
