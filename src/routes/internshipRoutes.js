const express = require("express");
const { protect } = require("../middleware/auth.js");
const upload = require("../middleware/upload");

const {
  createInternship,
  createMilestone,
  createConcept,
  createTask,
  createAssignment,
  updateConcept,
  updateTask,
  updateAssignment,
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
  getScheduledMentorInternships,
  getOngoingMentorInternships,
  getCurrentRequestedInternships,
  submitCohostDomain,
  respondCohostInvite,
  getInternshipsByStatus,
  getCurrentMentorWorkboard,
  getInternWorkboard,
  getDomainInterns,
  uploadConceptFiles,
  getConceptFiles,
  deleteConceptFile,
  upsertConceptProgress,
  upsertTaskProgress,
  getInternPerformance,
  submitAssignment,
  submitAssignmentFiles,
  uploadAssignmentFiles,
  getAssignmentFiles,
  deleteAssignmentFile,
  gradeAssignment,
  getAvailableInternshipsForIntern,
  getOngoingInternshipsWithProgress
} = require("../controller/internshipController.js");

const router = express.Router();

// -------------------------------
// CRUD
// -------------------------------
router.post("/", protect, createInternship);
router.post("/workboards/:workboardId/milestones", protect, createMilestone);
router.post("/milestones/:milestoneId/concepts", protect, createConcept);
router.put("/concepts/:conceptId", protect, updateConcept);
router.post("/milestones/:milestoneId/tasks", protect, createTask);
router.put("/tasks/:taskId", protect, updateTask);
router.post("/milestones/:milestoneId/assignments", protect, createAssignment);
router.put("/assignments/:assignmentId", protect, updateAssignment);
router.get(
  "/workboards/current/:internshipId",
  protect,
  getCurrentMentorWorkboard
);
router.get("/", getAllInternships);
router.delete("/:internshipId", protect, deleteInternship);
router.put("/:internshipId", protect, updateInternship);

router.post("/status/:status", protect, getInternshipsByStatus);

router.get("/current-mentor-internships", protect, getCurrentMentorInternships);
router.get("/current-mentor-scheduled-internships", protect, getScheduledMentorInternships);
router.get("/current-mentor-ongoing-internships", protect, getOngoingMentorInternships);
router.get("/current-mentor-requested-internships", protect, getCurrentRequestedInternships);
router.post("/:internshipId/cohost-domain", protect, submitCohostDomain);
router.post("/:internshipId/cohost/respond", protect, respondCohostInvite);
router.post("/:internshipId/accept-and-post", protect, approveAndPost);
router.post("/:internshipId/cohost-respond", protect, respondCohostInvite);

// -------------------------------
// INTERN ROUTES (PUT THESE FIRST)
// -------------------------------
router.post("/intern/join", protect, joinInternship);
router.get(
  "/intern/available-internships",
  protect,
  getAvailableInternshipsForIntern
);
router.get("/intern/workboards/:internshipId", protect, getInternWorkboard);
router.post(
  "/concepts/:conceptId/files",
  protect,
  upload.array("concept_files", 10),
  uploadConceptFiles
);
router.get("/concepts/:conceptId/files", protect, getConceptFiles);
router.delete(
  "/concepts/:conceptId/files/:fileId",
  protect,
  deleteConceptFile
);
router.get(
  "/intern/ongoing-with-progress",
  protect,
  getOngoingInternshipsWithProgress
);
router.post(
  "/intern/concepts/:conceptId/progress",
  protect,
  upsertConceptProgress
);
router.post("/intern/tasks/:taskId/progress", protect, upsertTaskProgress);
router.post(
  "/intern/assignments/:assignmentId/submit",
  protect,
  submitAssignment
);
router.post(
  "/intern/assignments/:assignmentId/submit-files",
  protect,
  upload.array("assignment_submission_files", 10),
  submitAssignmentFiles
);
router.post(
  "/assignments/:assignmentId/files",
  protect,
  upload.array("assignment_files", 10),
  uploadAssignmentFiles
);
router.get("/assignments/:assignmentId/files", protect, getAssignmentFiles);
router.delete(
  "/assignments/:assignmentId/files/:fileId",
  protect,
  deleteAssignmentFile
);
router.get(
  "/intern/performance/:internshipId",
  protect,
  getInternPerformance
);
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
router.post(
  "/mentor/assignments/:assignmentId/grade",
  protect,
  gradeAssignment
);
router.get(
  "/:internshipId/domains/:domainName/interns",
  protect,
  getDomainInterns
);

// -------------------------------
// PARAMETER ROUTES — MUST BE LAST
// -------------------------------
router.get("/:id", getInternshipById);
router.put("/:id", updateInternship);
router.delete("/:id", deleteInternship);

module.exports = router;
