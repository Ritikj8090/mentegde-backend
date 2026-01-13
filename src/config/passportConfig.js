const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const authRepository = require("../Repository/authRepository");
const jwt = require("jsonwebtoken");

const SECRET_KEY = process.env.JWT_SECRET;

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${process.env.BACKEND_BASE_URL}/api/auth/google/callback`,
      prompt: "consent",
      passReqToCallback: true,
    },
    async function (req, accessToken, refreshToken, profile, done) {
      try {
        // ✅ Extract role from "state"
        let role = "user";
        if (req.query.state?.startsWith("role:")) {
          role = req.query.state.split(":")[1] || "user";
        }

        console.log("✅ Extracted role from state param:", role);

        const user = await authRepository.findOrCreateGoogleUser(
          profile,
          accessToken,
          refreshToken,
          3600,
          role
        );

        const token = jwt.sign(
          {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            is_active: user.is_active,
          },
          SECRET_KEY,
          { expiresIn: "1h" }
        );

        return done(null, { user, token });
      } catch (error) {
        console.error("Error in GoogleStrategy:", error.message);
        return done(error, null);
      }
    }
  )
);

module.exports = passport;
