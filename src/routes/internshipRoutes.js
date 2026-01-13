const express = require("express");
const { protect } = require("../middleware/auth.js");

const {
  createInternship,
  getAllInternships,
  getInternshipById,
  updateInternship,
  deleteInternship,
  openForCohost,
  sendToHost,            
  approveAndPost,
  getInternshipsByFilter,
  joinInternship,
  getJoinedInternships,
  getOngoingInternships,
  getCurrentMentorInternships,
  getCurrentRequestedInternships
} = require("../controller/internshipController.js");

const router = express.Router();

// -------------------------------
// CRUD
// -------------------------------
router.post("/", protect, createInternship);
router.get("/", getAllInternships);
router.get("/current-mentor-internships", protect, getCurrentMentorInternships);
router.get("/current-mentor-requested-internships", protect, getCurrentRequestedInternships);


// -------------------------------
// INTERN ROUTES (PUT THESE FIRST)
// -------------------------------
router.post("/intern/join", joinInternship);
router.get("/intern/:internId/joined", getJoinedInternships);
router.get("/intern/:internId/ongoing", getOngoingInternships);

// -------------------------------
// FILTER ROUTE
// -------------------------------
router.get("/filter/:filter", getInternshipsByFilter);

// -------------------------------
// WORKFLOW ROUTES (STATIC PATHS)
// -------------------------------
router.put("/:id/open-cohost", openForCohost);
router.put("/:id/send-to-host", sendToHost);
router.put("/:id/approve-post", approveAndPost);

// -------------------------------
// PARAMETER ROUTES — MUST BE LAST
// -------------------------------
router.get("/:id", getInternshipById);
router.put("/:id", updateInternship);
router.delete("/:id", deleteInternship);

module.exports = router;
