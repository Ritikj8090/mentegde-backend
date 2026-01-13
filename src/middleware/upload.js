const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    let folder = "profiles";
    let resourceType = "image";

    if (file.fieldname === "resume") {
      folder = "resumes";
      resourceType = "raw"; // ✅ IMPORTANT
    }

    if (file.fieldname === "certificates") {
      folder = "certificates";
      resourceType = "raw"; // ✅ PDFs usually
    }

    return {
      folder,
      resource_type: resourceType,
      public_id: `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, "").replace(/\s+/g, "_")}`,
    };
  },
});


// ✅ File type validation
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/jpg",
    "application/pdf",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type. Only images & PDFs allowed"), false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // ✅ 5 MB per file
  },
  fileFilter,
});

module.exports = upload;
