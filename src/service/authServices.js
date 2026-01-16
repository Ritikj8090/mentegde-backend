const authRepository = require("../Repository/authRepository");
const jwt = require("jsonwebtoken");
const clientPromise = require("../config/redis"); // Import the Redis client promise
const passport = require("../config/passportConfig");
const db = require("../config/db");
const config = require("../config/apiConfig");
const websocketTokenService = require("./websocketTokenService");
const { sanitizeLiveMentorEntry } = require("../utils/sanitize");

const SECRET_KEY = process.env.JWT_SECRET;

const authService = {
  createUser: async (req, res) => {
    try {
      const { email, full_name, password } = req.body;

      if (!email || !full_name || !password) {
        return res
          .status(400)
          .json({ message: "email, full_name, and password are required" });
      }

      await authRepository.createUser(email, full_name, password);

      const { user, token, websocketToken } = await authRepository.loginUser(
        email,
        password
      );

      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 3600000,
        path: "/",
      });
      res.status(201).json({
        message: "User created successfully",
        data: user,
        token,
        websocketToken,
      });
    } catch (error) {
      console.error("Error in createUser service:", error);
      res.status(500).json({ message: error.message });
    }
  },

  loginUser: async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res
          .status(400)
          .json({ message: "email and password are required" });
      }

      const { user, token, websocketToken } = await authRepository.loginUser(
        email,
        password
      );

      if (!user || !token) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 3600000, // 1 hour
        path: "/",
      });
      const { password: _, ...safeUser } = user;
      res.status(200).json({
        message: "Login successful",
        data: safeUser,
        token,
        websocketToken,
      });
    } catch (error) {
      console.log(error.message);
      if (error.message === "Invalid email or password") {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  logoutUser: async (req, res) => {
    try {
      const token = req.cookies.token;
      if (!token) {
        return res.status(400).json({ message: "No token found" });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Fetch Google access token
      const googleTokenResult = await db.query(
        `SELECT access_token FROM mentor.oauth_tokens WHERE user_id = $1 AND provider = 'google'`,
        [decoded.id]
      );

      const googleAccessToken = googleTokenResult.rows[0]?.access_token;

      if (googleAccessToken) {
        const { google } = require("googleapis");
        const oauth2Client = new google.auth.OAuth2();

        try {
          oauth2Client.setCredentials({ access_token: googleAccessToken });
          await oauth2Client.revokeToken(googleAccessToken);
          console.log("Google access token revoked successfully.");
        } catch (revokeError) {
          if (
            revokeError.response &&
            revokeError.response.data.error === "invalid_token"
          ) {
            console.warn("Google access token was already invalid or expired.");
          } else {
            console.error("Error revoking Google access token:", revokeError);
          }
        }
      }

      // Wait for the Redis client to connect
      const client = await clientPromise;
      await client.setEx(`blacklist:${token}`, 3600, "blacklisted");

      res.clearCookie("token", {
        httpOnly: true,
        sameSite: "None",
        secure: true,
        path: "/",
      });

      return res.status(200).json({ message: "Logged out successfully" });
    } catch (error) {
      console.error("Logout error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },

  oboardingUser: async (req, res) => {
    try {
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
      console.log(req.body);
      if (
        !full_name ||
        !gender ||
        !date_of_birth ||
        !phone_number ||
        !bio ||
        !current_city ||
        !current_state ||
        !current_status ||
        !educations ||
        !languages ||
        !interests ||
        !resume_link ||
        !linkedin_link ||
        !github_link ||
        !hear_about ||
        !skills
      ) {
        return res.status(400).json({ message: "All fields are required" });
      }
      const {token, websocketToken, resultContent, resultMessage} = await authRepository.oboardingUser(req);

      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 3600000,
        path: "/",
      });
      res
        .status(200)
        .json({ message: resultMessage, data: resultContent });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Error updating user: " + error.message });
    }
  },

  getCurrentUser: async (req, res) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { dbUser } = await authRepository.findUser({ id: user.id });

      res.status(200).json({ message: "User found", data: dbUser });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }

  },

  findUser: async (req, res) => {
    try {
      const result = await authRepository.findUser(req.body);
      res.status(200).json({
        message: result?.resultMessage || "User lookup failed",
        data: result,
      });

      if (res.status(200)) {
        console.log("200");
      } else if (res.status(404)) {
        console.log("404");
      }
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  verifyUser: async (req, res) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const websocketToken = await websocketTokenService.generateToken(user.id);

      res.status(200).json({
        message: "User verified",
        user,
        websocketToken, // <-- ✅ Add this!
        token: req.cookies.token,
      });
    } catch (error) {
      res.status(401).json({ message: error.message });
    }
  },

  createMentor: async (req, res) => {
    try {
      const { email, full_name, password } = req.body;

      if (!email || !full_name || !password) {
        return res
          .status(400)
          .json({ message: "email, full_name, and password are required" });
      }

      await authRepository.createMentor(email, full_name, password);

      const { user, token, websocketToken } = await authRepository.loginMentor(
        email,
        password
      );

      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 3600000,
        path: "/",
      });
      res.status(201).json({
        message: "Mentor created successfully",
        data: user,
        token,
        websocketToken,
      });
    } catch (error) {
      console.error("Error in createUser service:", error);
      res.status(500).json({ message: error.message });
    }
  },

  loginMentor: async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res
          .status(400)
          .json({ message: "email and password are required" });
      }

      const { user, token, websocketToken } = await authRepository.loginMentor(
        email,
        password
      );

      if (!user || !token) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 3600000, // 1 hour
        path: "/",
      });
      const { password: _, ...safeUser } = user;
      res.status(200).json({
        message: "Login successful",
        data: safeUser,
        token,
        websocketToken,
      });
    } catch (error) {
      console.log(error.message);
      if (error.message === "Invalid email or password") {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      res.status(500).json({ message: "Internal Server Error" });
    }
  },

  oboardingMentor: async (req, res) => {
    try {
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
      console.log(req.body);
      if (
        !full_name ||
        !gender ||
        !date_of_birth ||
        !phone_number ||
        !bio ||
        !current_city ||
        !current_state ||
        !current_status ||
        !educations ||
        !languages ||
        !interests ||
        !resume_link ||
        !linkedin_link ||
        !github_link ||
        !hear_about ||
        !skills
      ) {
        return res.status(400).json({ message: "All fields are required" });
      }
      const {token, websocketToken, resultContent, resultMessage} = await authRepository.oboardingMentor(req);

      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 3600000,
        path: "/",
      });
      res
        .status(200)
        .json({ message: resultMessage, data: resultContent });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Error updating mentor: " + error.message });
    }
  },

  findMentors: async (req, res) => {
    try {

      let excludeId = null;
      if (req.user?.role === "mentor") {
        excludeId = req.user.id;
      } else if (req.cookies?.token) {
        try {
          const decoded = jwt.verify(req.cookies.token, SECRET_KEY);
          if (decoded?.role === "mentor") {
            excludeId = decoded.id;
          }
        } catch (error) {
          excludeId = null;
        }
      }

      const {dbUser} = await authRepository.findMentors({
        ...req.body,
        excludeId,
      });
      res.status(200).json({
        data: dbUser,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  findMentor: async (req, res) => {
    try {

      const {dbUser} = await authRepository.findMentor(req.body);
      res.status(200).json({
        data: dbUser,
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },

  // Google OAuth
  googleLogin: (req, res, next) => {
    const state = req.query.state || "";
    passport.authenticate("google", {
      scope: ["profile", "email"],
      session: false,
      state,
    })(req, res, next);
  },

  googleCallback: async (req, res) => {
    try {
      const role = req.query.role || "user";
      const { user, token } = req.user;

      // Wait for the Redis client to connect
      const client = await clientPromise;

      // Double-check blacklist
      const isBlacklisted = await client.get(`blacklist:${token}`);
      if (isBlacklisted) {
        console.log(
          "Google OAuth: Blacklisted token detected even in callback."
        );
        return res.redirect(`${config.baseURL}/signin?error=session_expired`);
      }

      // Check if the user already has an active session (optional, depends on your app's logic)
      if (req.cookies.token) {
        console.warn("Google OAuth: User already had a session. Invalidating.");
        res.clearCookie("token"); // Force a clear if a cookie existed
        return res.redirect(`${config.baseURL}/signin?error=already_logged_in`);
      }

      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 3600000,
        path: "/",
      });

      await db.query({
        text: "UPDATE mentor.users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1",
        values: [user.id],
      });

      res.redirect(`${config.baseURL}/dashboard`);
    } catch (error) {
      console.error("Google OAuth Error:", error);
      res.status(500).json({ message: "Google OAuth authentication failed" });
    }
  },

  checkUsernameAvailability: async (req, res) => {
    try {
      const { username } = req.body;
      if (!username || username.trim().length < 2) {
        return res.status(400).json({ message: "Invalid username" });
      }

      const normalized = username.trim().toLowerCase();
      const redis = await clientPromise;
      const redisKey = `username:${normalized}`;

      // Check Redis cache first
      const cached = await redis.get(redisKey);
      if (cached !== null) {
        return res.status(200).json({ available: cached === "true" });
      }

      // Check Postgres via repository
      const isAvailable = await authRepository.checkUsernameAvailability(
        normalized
      );

      // Cache result for 30 minutes
      await redis.setEx(redisKey, 1800, isAvailable.toString());

      return res.status(200).json({ available: isAvailable });
    } catch (error) {
      console.error("Service: checkUsernameAvailability error:", error.message);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },

  checkEmailAvailability: async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || !email.includes("@")) {
        return res.status(400).json({ message: "Invalid email" });
      }

      const normalized = email.trim().toLowerCase();
      const redis = await clientPromise;
      const redisKey = `email:${normalized}`;

      // Check Redis cache first
      const cached = await redis.get(redisKey);
      if (cached !== null) {
        return res.status(200).json({ available: cached === "true" });
      }

      // Check Postgres via repository
      const isAvailable = await authRepository.checkEmailAvailability(
        normalized
      );

      // Cache result for 30 minutes
      await redis.setEx(redisKey, 1800, isAvailable.toString());

      return res.status(200).json({ available: isAvailable });
    } catch (error) {
      console.error("Service: checkEmailAvailability error:", error.message);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  },

  onboardUser: async (req, res) => {
    try {
      const result = await authRepository.onboardUser(req);

      if (result.status !== "SUCCESS") {
        return res.status(400).json({ message: result.message });
      }

      // ✅ Fetch updated user after onboarding
      const updatedUser = await authRepository.findUser({ id: req.user.id });
      if (!updatedUser || !updatedUser.resultContent) {
        return res
          .status(404)
          .json({ message: "User not found after onboarding" });
      }

      const user = updatedUser.resultContent;

      // ✅ Issue new token with updated is_active = true
      const token = jwt.sign(
        {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          is_active: user.is_active, // this should now be true
        },
        SECRET_KEY,
        { expiresIn: "1h" }
      );

      res.cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 3600000,
        path: "/",
      });

      // ✅ Optionally, include user in response for frontend Redux update
      return res.status(200).json({ user, message: result.message });
    } catch (error) {
      console.error("Error in onboardUser:", error.message);
      return res.status(500).json({ message: "Internal Server error" });
    }
  },

  updateMentorLiveStatus: async (req, res) => {
    try {
      const { isLive } = req.body;
      const userId = req.user.id;
      const client = await clientPromise;

      const result = await db.query(
        `
      SELECT 
        u.id AS user_id, u.username, u.email, u.role,
        m.bio, m.expertise, m.rating
      FROM mentor.users u
      JOIN mentor.mentors m ON m.user_id = u.id
      WHERE u.id = $1
    `,
        [userId]
      );

      const mentor = result.rows[0];
      if (!mentor) {
        return res.status(404).json({ message: "Mentor not found" });
      }

      const profile = {
        ...mentor,
        is_live: isLive,
      };

      const sanitized = sanitizeLiveMentorEntry(profile);
      if (!sanitized) {
        return res.status(500).json({ message: "Invalid mentor data" });
      }

      // Determine TTL from session duration
      let ttlSeconds = 3600;
      const sessionResult = await db.query(
        `SELECT duration FROM mentor.sessions 
       WHERE mentor_id = $1 
       AND start_time <= NOW() AND end_time >= NOW()
       ORDER BY start_time DESC LIMIT 1`,
        [userId]
      );
      if (sessionResult.rows.length) {
        const rawDuration = sessionResult.rows[0].duration;

        if (typeof rawDuration === "string") {
          const [hh, mm, ss] = rawDuration.split(":").map(Number);
          ttlSeconds = hh * 3600 + mm * 60 + (ss || 0);
        } else if (typeof rawDuration === "object" && rawDuration.minutes) {
          ttlSeconds = rawDuration.minutes * 60;
        } else if (typeof rawDuration === "number") {
          ttlSeconds = rawDuration;
        } else {
          console.warn(
            "⚠️ Unrecognized duration format. Falling back to 3600s."
          );
          ttlSeconds = 3600;
        }
      }

      // Redis logic
      if (isLive) {
        // Push to Redis
        await client.set(`mentor:${userId}`, JSON.stringify(sanitized), {
          EX: ttlSeconds,
        });

        if (isLive) {
          const all = await client.lRange("liveMentors", 0, -1);
          let alreadyExists = false;

          for (const entry of all) {
            try {
              const parsed = JSON.parse(entry);
              if (parsed?.user_id === userId) {
                alreadyExists = true;
                break;
              }
            } catch (err) {
              console.warn("Invalid mentor entry in Redis:", entry);
            }
          }

          // Only push if NOT already in the list AND profile is complete
          const hasEssentialFields =
            sanitized.username &&
            sanitized.email &&
            sanitized.username !== "Unknown";

          if (!alreadyExists && hasEssentialFields) {
            await client.lPush("liveMentors", JSON.stringify(sanitized));
          } else {
            console.log(
              "Skipped pushing duplicate or incomplete mentor entry."
            );
          }

          // Set TTL’d key anyway
          await client.set(`mentor:${userId}`, JSON.stringify(sanitized), {
            EX: ttlSeconds,
          });
        }
      } else {
        // Clean up
        const all = await client.lRange("liveMentors", 0, -1);
        for (const entry of all) {
          const parsed = sanitizeLiveMentorEntry(entry);
          if (parsed?.user_id === userId) {
            await client.lRem("liveMentors", 0, entry);
          }
        }
        await client.del(`mentor:${userId}`);
      }

      // Notify frontend
      await client.publish(
        "mentor:liveStatus",
        JSON.stringify({ mentorId: userId, isLive })
      );

      return res.status(200).json({
        message: "Live status updated (Redis only)",
        mentor: sanitized,
      });
    } catch (error) {
      console.error("updateMentorLiveStatus error:", error.message);
      res.status(500).json({ message: "Live status update failed" });
    }
  },

  getLiveMentors: async (req, res) => {
    try {
      const liveMentors = await authRepository.getLiveMentors();
      res.status(200).json(liveMentors);
    } catch (error) {
      console.error("Error fetching live mentors:", error);
      res.status(500).json({ message: "Failed to fetch live mentors" });
    }
  },

  getMentors: async (req, res) => {
    try {
      const mentors = await authRepository.getMentors();
      res.status(200).json(mentors);
    } catch (error) {
      console.error("Error fetching mentors:", error.message);
      res.status(500).json({ message: error.message });
    }
  },

  getMentorProfile: async (req, res) => {
    try {
      const userId = req.user.id;
      const profile = await authRepository.getMentorProfile(userId);

      if (!profile) {
        return res.status(404).json({ message: "Profile not found" });
      }

      return res.status(200).json(profile);
    } catch (error) {
      console.error("getMentorProfile error:", error.message);
      return res.status(500).json({ message: "Internal server error" });
    }
  },

  registerUser: async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        current_city,
        current_status,
        resume_link,
        hear_about,
        skills,
        gender,
      } = req.body;

      // ✅ Validation
      if (!name || !email || !password) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      // ✅ Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // ✅ Insert into mentor.users
      const query = `
        INSERT INTO mentor.users
          (name, email, password, gender, current_city, current_status, resume_link, hear_about, skills)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING user_id;
      `;

      const values = [
        name,
        email,
        hashedPassword,
        gender,
        current_city,
        current_status,
        resume_link,
        hear_about,
        skills,
      ];

      const result = await db.query(query, values);

      return res.status(201).json({
        message: "User registered successfully",
        userId: result.rows[0].user_id,
      });
    } catch (err) {
      console.error("registerUser error:", err.message);
      return res.status(500).json({ message: "Internal server error" });
    }
  },

  registerMentor: async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        expertise_area,
        years_of_experience,
        linkedin_portfolio_link,
        availability,
        resume_link,
      } = req.body;

      // ✅ Validation
      if (!name || !email || !password || !expertise_area) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // ✅ Insert into mentor.mentors
      const query = `
        INSERT INTO mentor.mentors
          (name, email, password, expertise_area, years_of_experience, linkedin_portfolio_link, availability, resume_link)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING mentor_id;
      `;

      const values = [
        name,
        email,
        hashedPassword,
        expertise_area,
        years_of_experience,
        linkedin_portfolio_link,
        availability,
        resume_link,
      ];

      const result = await db.query(query, values);

      return res.status(201).json({
        message: "Mentor registered successfully",
        mentorId: result.rows[0].mentor_id,
      });
    } catch (err) {
      console.error("registerMentor error:", err.message);
      return res.status(500).json({ message: "Internal server error" });
    }
  },
  uploadProfileAssets: async (req, res) => {
    try {
      const userId = req.params.id;

      const profilePic = req.files?.profile_pic?.[0]?.path || null;
      const resume = req.files?.resume?.[0]?.path || null;

      const certificatesArray =
        req.files?.certificates?.map((f) => f.path) || null;

      const certificatesJSON = certificatesArray
        ? JSON.stringify(certificatesArray)
        : null;

      const result = await db.query(
        `
      UPDATE mentor.user
      SET
        profile_pic = COALESCE($1, profile_pic),
        resume_link = COALESCE($2, resume_link),
        certificates = COALESCE($3, certificates)
      WHERE id = $4
      RETURNING *;
      `,
        [
          profilePic,
          resume,
          certificatesJSON, // ✅ JSON-safe
          userId,
        ]
      );

      res.status(200).json({
        message: "Files uploaded successfully",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ message: "Upload failed" });
    }
  },

  uploadMentorProfileAssets: async (req, res) => {
    try {
      const mentorId = req.params.id;

      const profilePic = req.files?.profile_pic?.[0]?.path || null;
      const resume = req.files?.resume?.[0]?.path || null;

      const certificatesArray =
        req.files?.certificates?.map((f) => f.path) || null;

      const certificatesJSON = certificatesArray
        ? JSON.stringify(certificatesArray)
        : null;

      const result = await db.query(
        `
      UPDATE mentor.mentor
      SET
        profile_pic = COALESCE($1, profile_pic),
        resume_pdf_url = COALESCE($2, resume_pdf_url),
        certifications = COALESCE($3, certifications)
      WHERE id = $4
      RETURNING *;
      `,
        [profilePic, resume, certificatesJSON, mentorId]
      );

      res.status(200).json({
        message: "Mentor files uploaded successfully",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Mentor upload error:", error);
      res.status(500).json({ message: "Upload failed" });
    }
  },
};

module.exports = authService;
