const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure uploads/profile_photos directory exists
const uploadDir = path.join(process.cwd(), "uploads", "profile_photos");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Allowed image types
const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (_, __, cb) => {
    cb(null, uploadDir);
  },

  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName =
      Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    cb(null, safeName);
  },
});

// File validation
function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (
    allowedMimeTypes.includes(file.mimetype) &&
    allowedExtensions.includes(ext)
  ) {
    cb(null, true);
  } else {
    cb(
      new Error("Only JPG, PNG and WebP images are allowed"),
      false
    );
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB max
  },
});

module.exports = { upload, uploadDir };
