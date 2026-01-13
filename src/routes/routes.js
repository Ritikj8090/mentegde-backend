const express = require("express");
const router = express.Router();
const { authenticate, authorizeRole } = require("../middleware/authMiddleware");
const DashboardController = require("../controller/dashboardController");
const roleRedirect = require("../middleware/roleRedirect");
const SessionService = require("../service/sessionServices");
const followService = require("../service/followService");
const authService = require("../service/authServices");
const passport = require("../config/passportConfig");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db.js");

const { protect } = require("../middleware/auth.js");

const sessionController = require("../controller/sessionController");
const chatService = require("../service/chatService");
const websocketTokenService = require("../service/websocketTokenService");

const { upload } = require("../middleware/uploadProfilePhoto");

// User authentication routes
router.post("/signup", authService.createUser);
router.post("/login", authService.loginUser);
router.post("/logout", authService.logoutUser);

// User management routes
router.put("/oboarding-user", protect, authService.oboardingUser);
router.post("/current-user", protect, authService.getCurrentUser);
router.post("/find", authService.findUser);

// Mentor authentication routes
router.post("/mentor-signup", authService.createMentor);
router.post("/mentor-login", authService.loginMentor);
router.post("/find-mentor", authService.findMentor);
router.post("/find-mentors", authService.findMentors);


router.get("/google", authService.googleLogin);
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/", session: false }),
  authService.googleCallback
);
router.get("/verify", authenticate, authService.verifyUser);
router.post("/check-username", authService.checkUsernameAvailability);
router.post("/check-email", authService.checkEmailAvailability);
router.post("/onboard", authenticate, authService.onboardUser);

router.post("/upload/avatar", upload.single("avatar"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      message: "No file uploaded",
    });
  }

  res.json({
    url: `/uploads/profile_photos/${req.file.filename}`,
  });
});


//upload
router.put(
  "/user/profile/upload/:id",
  upload.fields([
    { name: "profile_pic", maxCount: 1 },
    { name: "resume", maxCount: 1 },
    { name: "certificates", maxCount: 10 },
  ]),
  authService.uploadProfileAssets
);

// Live-Session routes
router.post("/create-session", SessionService.createSession);
router.post("/fetch-session", SessionService.fetchSession);

//Session-participants
router.get(
  "/session/:sessionId/participant-count",
  authenticate,
  sessionController.getLiveParticipantCount
);

router.get("/mentors", authenticate, authService.getMentors);
router.post(
  "/updateMentorLiveStatus",
  authenticate,
  authService.updateMentorLiveStatus
);
router.get("/mentors/live", authenticate, authService.getLiveMentors);
router.post("/fetch-session-by-mentor", sessionController.fetchSessionByMentor);
router.get("/sessions/public/:mentorId", sessionController.getPublicSession);
router.post(
  "/mentor/profile",
  authenticate,
  authorizeRole(["mentor"]),
  authService.getMentorProfile
);
router.post(
  "/end-session",
  authenticate,
  authorizeRole(["mentor"]),
  SessionService.endSession
);

// Role-Based Routes
router.get(
  "/dashboard",
  authenticate,
  roleRedirect,
  DashboardController.dashboard
);

// Follow-Routes
router.post("/follow", authenticate, followService.sendFollowRequest);
router.post("/unfollow", authenticate, followService.unfollowMentor);
router.post(
  "/follow/accept",
  authenticate,
  authorizeRole(["mentor"]),
  followService.acceptFollowRequest
);
router.post(
  "/follow/reject",
  authenticate,
  authorizeRole(["mentor"]),
  followService.rejectFollowRequest
);
router.get(
  "/mentor/:mentorId/followers",
  authenticate,
  followService.getFollowers
);
router.get(
  "/mentor/:mentorId/is-following",
  authenticate,
  followService.isUserFollowingMentor
);
router.get(
  "/follow/status/:mentorId",
  authenticate,
  followService.isUserFollowingMentor
);
router.get(
  "/follow/pending",
  authenticate,
  authorizeRole(["mentor"]),
  followService.getPendingFollowRequests
);

// Chat-Conversation
router.post("/chat/conversations", authenticate, chatService.getConversations);
router.post("/chat/messages", authenticate, chatService.getMessages);
router.post("/chat/send-message", authenticate, chatService.sendMessageHandler);
router.post(
  "/chat/initiate",
  authenticate,
  chatService.initiateConversationHandler
);
router.get(
  "/refresh-ws-token",
  authenticate,
  websocketTokenService.refreshTokenHandler
);

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "Strict",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });
};

// ==================== USER ROUTES ====================

// Register (User)
router.post("/user/register", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      current_city,
      gender,
      current_status,
      resume_link,
      hear_about,
      skills,
    } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Please provide all required fields" });
    }

    const userExists = await pool.query(
      "SELECT * FROM mentor.user WHERE email = $1",
      [email]
    );
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await pool.query(
      `INSERT INTO mentor.user
       (name, email, password, current_city, gender, current_status, resume_link, hear_about, skills)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, email`,
      [
        name,
        email,
        hashedPassword,
        current_city,
        gender,
        current_status,
        resume_link,
        hear_about,
        skills,
      ]
    );

    const token = generateToken(newUser.rows[0].id, "user");
    res.cookie("token", token, cookieOptions);

    return res.status(201).json({ user: newUser.rows[0] });
  } catch (error) {
    console.error("User registration error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Login (User)
router.post("/user/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await pool.query(
      "SELECT * FROM mentor.user WHERE email = $1",
      [email]
    );
    if (user.rows.length === 0) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const userData = user.rows[0];
    const isMatch = await bcrypt.compare(password, userData.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = generateToken(userData.id, "user");
    res.cookie("token", token, cookieOptions);

    res.json({
      user: {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        role: "user",
      },
    });
  } catch (error) {
    console.error("User login error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== MENTOR ROUTES ====================

// Register (Mentor)
router.post("/mentor/register", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      expertise_area,
      years_of_experience,
      linkedin_portfolio_link,
      resume_pdf_url,
      availability,
    } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Please provide all required fields" });
    }

    const mentorExists = await pool.query(
      "SELECT * FROM mentor.mentor WHERE email = $1",
      [email]
    );
    if (mentorExists.rows.length > 0) {
      return res.status(400).json({ message: "Mentor already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newMentor = await pool.query(
      `INSERT INTO mentor.mentor 
       (name, email, password, expertise_area, years_of_experience, linkedin_portfolio_link, resume_pdf_url, availability)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, email`,
      [
        name,
        email,
        hashedPassword,
        expertise_area,
        years_of_experience,
        linkedin_portfolio_link,
        resume_pdf_url,
        availability,
      ]
    );

    const token = generateToken(newMentor.rows[0].id, "mentor");
    res.cookie("token", token, cookieOptions);

    return res.status(201).json({ mentor: newMentor.rows[0] });
  } catch (error) {
    console.error("Mentor registration error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Login (Mentor)
router.post("/mentor/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const mentor = await pool.query(
      "SELECT * FROM mentor.mentor WHERE email = $1",
      [email]
    );
    if (mentor.rows.length === 0) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const mentorData = mentor.rows[0];
    const isMatch = await bcrypt.compare(password, mentorData.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = generateToken(mentorData.id, "mentor");
    res.cookie("token", token, cookieOptions);

    res.json({
      mentor: {
        id: mentorData.id,
        name: mentorData.name,
        email: mentorData.email,
        role: "mentor",
      },
    });
  } catch (error) {
    console.error("Mentor login error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email || !role)
      return res.status(400).json({ message: "Email & role required" });

    const table = role === "mentor" ? "mentor.mentor" : "mentor.user";

    const user = await pool.query(`SELECT * FROM ${table} WHERE email = $1`, [
      email,
    ]);
    if (user.rows.length === 0)
      return res.status(404).json({ message: "Account not found" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `UPDATE ${table} SET reset_otp = $1, otp_expiry = $2 WHERE email = $3`,
      [otp, expiry, email]
    );

    return res.json({
      message: "OTP sent successfully",
      otp, // temp — in real world send via SMS/email
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp, role } = req.body;

    if (!email || !otp || !role)
      return res.status(400).json({ message: "Missing fields" });

    const table = role === "mentor" ? "mentor.mentor" : "mentor.user";

    const user = await pool.query(`SELECT * FROM ${table} WHERE email = $1`, [
      email,
    ]);
    if (user.rows.length === 0)
      return res.status(404).json({ message: "Account not found" });

    const data = user.rows[0];

    if (data.reset_otp !== otp)
      return res.status(400).json({ message: "Invalid OTP" });

    if (new Date() > new Date(data.otp_expiry))
      return res.status(400).json({ message: "OTP expired" });

    return res.json({ message: "OTP verified successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { email, newPassword, role } = req.body;

    const table = role === "mentor" ? "mentor.mentor" : "mentor.user";

    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE ${table} SET password = $1, reset_otp = NULL, otp_expiry = NULL WHERE email = $2`,
      [hashed, email]
    );

    res.json({ message: "Password reset successful" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/change-password", async (req, res) => {
  try {
    const { id, role, currentPassword, newPassword } = req.body;

    const table = role === "mentor" ? "mentor.mentor" : "mentor.user";

    const user = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);

    if (user.rows.length === 0)
      return res.status(404).json({ message: "User not found" });

    const data = user.rows[0];

    const isMatch = await bcrypt.compare(currentPassword, data.password);
    if (!isMatch)
      return res.status(400).json({ message: "Wrong current password" });

    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(`UPDATE ${table} SET password = $1 WHERE id = $2`, [
      hashed,
      id,
    ]);

    return res.json({ message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ==================== COMMON ROUTES ====================

// Me (Protected route)
router.get("/me", protect, async (req, res) => {
  res.json(req.user);
});

// Logout
router.post("/logout", (req, res) => {
  res.cookie("token", "", { ...cookieOptions, maxAge: 1 });
  res.json({ message: "Logged out successfully" });
});

// ==================== FETCH USER PROFILE ====================
router.get("/user/profile/:id", async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT 
        id,
        name,
        email,
        intro,
        profile_pic,
        current_city,
        gender,
        current_status,
        resume_link,
        hear_about,
        skills,
        education,
        learning_goals AS "learningGoals",
        interests,
        availability,
        engagement,
        experience,
        joined_internships AS "joinedInternships",
        completed_tasks AS "completedTasks",
        feedback,
        certificates,
        badges,
        created_at
      FROM mentor.user
      WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = result.rows[0];

    // Safely parse JSON fields (if they exist)
    const parseJSON = (field) => {
      if (!field) return [];

      if (Array.isArray(field)) return field;

      if (typeof field === "object") return field;

      try {
        return JSON.parse(field);
      } catch (e) {
        console.error("JSON parse failed:", field);
        return [];
      }
    };

    user.skills = parseJSON(user.skills);
    user.education = parseJSON(user.education);
    user.interests = parseJSON(user.interests);
    user.experience = parseJSON(user.experience);
    user.joinedInternships = parseJSON(user.joinedInternships);
    user.completedTasks = parseJSON(user.completedTasks);
    user.certificates = parseJSON(user.certificates);
    user.badges = parseJSON(user.badges);

    res.json(user);
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update User Profile (with optional profile photo)
router.put(
  "/user/profile/:id",

  async (req, res) => {
    const userId = req.params.id;

    try {
      // Collect all fields from req.body
      const {
        name,
        intro,
        current_city,
        gender,
        current_status,
        resume_link,
        hear_about,
        skills,
        education,
        learningGoals,
        interests,
        availability,
        engagement,
        experience,
        joinedInternships,
        completedTasks,
        feedback,
        certificates,
        badges,
      } = req.body;

      const query = `
        UPDATE mentor.user
SET
  name = COALESCE($1, name),
  intro = COALESCE($2, intro),
  current_city = COALESCE($3, current_city),
  gender = COALESCE($4, gender),
  current_status = COALESCE($5, current_status),
  hear_about = COALESCE($6, hear_about),
  skills = COALESCE($7, skills),
  education = COALESCE($8, education),
  learning_goals = COALESCE($9, learning_goals),
  interests = COALESCE($10, interests),
  availability = COALESCE($11, availability),
  engagement = COALESCE($12, engagement),
  experience = COALESCE($13, experience),
  joined_internships = COALESCE($14, joined_internships),
  completed_tasks = COALESCE($15, completed_tasks),
  feedback = COALESCE($16, feedback),
  badges = COALESCE($17, badges)
WHERE id = $18
RETURNING *;

      `;

      const values = [
        name,
        intro,
        current_city,
        gender,
        current_status,
        hear_about,
        skills ? JSON.stringify(skills) : null,
        education ? JSON.stringify(education) : null,
        learningGoals,
        interests ? JSON.stringify(interests) : null,
        availability,
        engagement,
        experience ? JSON.stringify(experience) : null,
        joinedInternships ? JSON.stringify(joinedInternships) : null,
        completedTasks ? JSON.stringify(completedTasks) : null,
        feedback,
        badges ? JSON.stringify(badges) : null,
        userId,
      ];

      const result = await pool.query(query, values);
      res.json({
        message: "Profile updated successfully",
        user: result.rows[0],
      });
    } catch (err) {
      console.error("Error updating profile:", err.message);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Fetch Mentor Profile by ID
// ✅ Fetch Mentor Profile by ID (fixed for frontend compatibility)
router.get("/mentor/profile/:id", async (req, res) => {
  const mentorId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT
        id,
        name,
        email,
        bio,
        expertise_area,
        years_of_experience,
        linkedin_portfolio_link,
        resume_pdf_url,
        availability,
        location,
        curren_role AS "current_role",
        organization,
        skills,
        languages,
        mentorship_focus,
        mentorship_mode,
        previous_projects,
        certifications,
        testimonials,
        internships_hosted,
        rating,
        badges,
        profile_pic,
        upi_id,
        bank_details,
        created_at
      FROM mentor.mentor
      WHERE id = $1`,
      [mentorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Mentor not found" });
    }

    const mentor = result.rows[0];

    const parseJSON = (field) => {
      if (!field) return [];
      if (Array.isArray(field)) return field;
      if (typeof field === "object") return field;

      try {
        return JSON.parse(field);
      } catch {
        return [];
      }
    };

    mentor.skills = parseJSON(mentor.skills);
    mentor.languages = parseJSON(mentor.languages);
    mentor.mentorship_focus = parseJSON(mentor.mentorship_focus);
    mentor.mentorship_mode = parseJSON(mentor.mentorship_mode);
    mentor.previous_projects = parseJSON(mentor.previous_projects);
    mentor.certifications = parseJSON(mentor.certifications);
    mentor.badges = parseJSON(mentor.badges);
    mentor.bank_details = parseJSON(mentor.bank_details);

    // ✅ Extract feedback from testimonials JSONB (if exists)
    const testimonials = parseJSON(mentor.testimonials);
    mentor.feedback =
      Array.isArray(testimonials) && testimonials.length > 0
        ? testimonials[0].feedback
        : "";

    res.json(mentor);
  } catch (error) {
    console.error("Error fetching mentor profile:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put(
  "/mentor/profile/upload/:id",
  upload.fields([
    { name: "profile_pic", maxCount: 1 },
    { name: "resume", maxCount: 1 },
    { name: "certificates", maxCount: 10 },
  ]),
  authService.uploadMentorProfileAssets
);

// ✅ Update Mentor Profile (handles JSONB, file, and bio)
router.put(
  "/mentor/profile/:id",

  async (req, res) => {
    const mentorId = req.params.id;

    try {
      const {
        name,
        bio, // ✅ now included
        expertise_area,
        years_of_experience,
        linkedin_portfolio_link,
        resume_pdf_url,
        availability,
        location,
        current_role,
        organization,
        skills,
        languages,
        mentorship_focus,
        mentorship_mode,
        previous_projects,
        certifications,
        testimonials,
        internships_hosted,
        rating,
        badges,
        profile_pic,
        upi_id, // ✅ ADD
        bank_details,
      } = req.body;

      const profilePic = req.file
        ? `/uploads/profile_photos/${req.file.filename}`
        : null;

      const safeArray = (value) => {
        if (!value) return null;
        try {
          const arr = Array.isArray(value) ? value : JSON.parse(value);
          return JSON.stringify(arr);
        } catch {
          return JSON.stringify([]);
        }
      };

      if (upi_id && !upi_id.includes("@")) {
        return res.status(400).json({ message: "Invalid UPI ID" });
      }

      if (
        bank_details?.ifsc_code &&
        !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank_details.ifsc_code)
      ) {
        return res.status(400).json({ message: "Invalid IFSC code" });
      }

      const query = `
       UPDATE mentor.mentor
SET
  name = COALESCE($1, name),
  bio = COALESCE($2, bio),
  expertise_area = COALESCE($3, expertise_area),
  years_of_experience = COALESCE($4, years_of_experience),
  linkedin_portfolio_link = COALESCE($5, linkedin_portfolio_link),
  resume_pdf_url = COALESCE($6, resume_pdf_url),
  availability = COALESCE($7, availability),
  location = COALESCE($8, location),
  curren_role = COALESCE($9, curren_role),
  organization = COALESCE($10, organization),
  skills = COALESCE($11, skills),
  languages = COALESCE($12, languages),
  mentorship_focus = COALESCE($13, mentorship_focus),
  mentorship_mode = COALESCE($14, mentorship_mode),
  previous_projects = COALESCE($15, previous_projects),
  certifications = COALESCE($16, certifications),
  testimonials = COALESCE($17, testimonials),
  internships_hosted = COALESCE($18, internships_hosted),
  rating = COALESCE($19, rating),
  badges = COALESCE($20, badges),
  upi_id = COALESCE($21, upi_id),
  bank_details = COALESCE($22, bank_details)
WHERE id = $23
RETURNING *;
      `;

      const values = [
        name,
        bio,
        expertise_area,
        years_of_experience,
        linkedin_portfolio_link,
        resume_pdf_url,
        availability,
        location,
        current_role,
        organization,
        safeArray(skills),
        safeArray(languages),
        safeArray(mentorship_focus),
        safeArray(mentorship_mode),
        safeArray(previous_projects),
        safeArray(certifications),
        safeArray(testimonials),
        internships_hosted,
        rating,
        safeArray(badges),
        upi_id,
        bank_details ? JSON.stringify(bank_details) : null,
        mentorId,
      ];

      const result = await pool.query(query, values);

      res.json({
        message: "✅ Mentor profile updated successfully",
        mentor: result.rows[0],
      });
    } catch (err) {
      console.error("Error updating mentor profile:", err.message);
      res
        .status(500)
        .json({ message: "Server error while updating mentor profile" });
    }
  }
);

module.exports = router;
