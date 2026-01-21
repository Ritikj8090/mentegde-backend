const sessionService = require("../service/sessionServices");

const fetchSessionByMentor = async (req, res) => {
  const { mentor_id } = req.body;
  try {
    const session = await sessionService.getLiveSessionByMentorIdService(
      mentor_id
    );
    if (!session) {
      return res.status(404).json({ message: "No active session" });
    }
    res.status(200).json({ resultStatus: "S", resultContent: session });
  } catch (err) {
    res.status(500).json({ resultStatus: "F", resultMessage: err.message });
  }
};

const getPublicSession = async (req, res) => {
  const mentorId = req.params.mentorId;

  try {
    const session = await sessionService.fetchSessionByMentorService(mentorId);
    res.status(200).json({
      resultStatus: "S",
      resultContent: session,
    });
  } catch (error) {
    console.error("Error fetching public session:", error.message);
    res.status(error.status || 500).json({
      resultStatus: "F",
      resultMessage: error.message || "Session not found or not live",
    });
  }
};

const getLiveParticipantCount = async (req, res) => {
  const { sessionId } = req.params;

  try {
    const participants = await sessionService.getLiveParticipantCountService(
      sessionId
    );

    res.status(200).json({
      resultStatus: "S",
      resultContent: {
        count: participants.length,
        participants, // 👈 Is this an array of objects or just a number?
      },
    });
  } catch (error) {
    console.error("Participant fetch error:", error.message);
    res.status(500).json({
      resultStatus: "F",
      resultMessage: error.message || "Internal server error",
    });
  }
};

module.exports = {
  fetchSessionByMentor,
  getPublicSession,
  getLiveParticipantCount,
};
