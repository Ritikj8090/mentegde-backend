const followRepository = require("../Repository/followRepository");

const sendFollowRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { mentorId } = req.body;

    if (userId === mentorId) {
      return res.status(400).json({ message: "You cannot follow yourself." });
    }

    const existingFollow = await followRepository.findFollow(userId, mentorId);
    if (existingFollow && existingFollow.status === 1) {
      return res
        .status(409)
        .json({ message: "Already following this mentor." });
    }

    await followRepository.createFollow(userId, mentorId);

    return res.status(201).json({ message: "Follow request sent." });
  } catch (error) {
    console.error("Follow Request Error:", error.message);
    return res.status(500).json({ message: "Failed to send follow request." });
  }
};

const unfollowMentor = async (req, res) => {
  try {
    const userId = req.user.id;
    const { mentorId } = req.body;

    await followRepository.deleteFollow(userId, mentorId);

    return res.status(200).json({ message: "Unfollowed successfully." });
  } catch (error) {
    console.error("Unfollow Error:", error.message);
    return res.status(500).json({ message: "Failed to unfollow mentor." });
  }
};

const acceptFollowRequest = async (req, res) => {
  try {
    const mentorId = req.user.id;
    const { userId } = req.body;

    await followRepository.updateFollowStatus(userId, mentorId, 1);

    return res.status(200).json({ message: "Follow request accepted." });
  } catch (error) {
    console.error("Accept Follow Error:", error.message);
    return res
      .status(500)
      .json({ message: "Failed to accept follow request." });
  }
};

const rejectFollowRequest = async (req, res) => {
  try {
    const mentorId = req.user.id;
    const { userId } = req.body;

    await followRepository.updateFollowStatus(userId, mentorId, 2);

    return res.status(200).json({ message: "Follow request rejected." });
  } catch (error) {
    console.error("Reject Follow Error:", error.message);
    return res
      .status(500)
      .json({ message: "Failed to reject follow request." });
  }
};

const getFollowers = async (req, res) => {
  try {
    const mentorId = req.params.mentorId;

    const followers = await followRepository.getFollowers(mentorId);

    return res.status(200).json({ followers });
  } catch (error) {
    console.error("Get Followers Error:", error.message);
    return res.status(500).json({ message: "Failed to fetch followers." });
  }
};

const isUserFollowingMentor = async (req, res) => {
  try {
    const userId = req.user.id;
    const mentorId = req.params.mentorId;

    const follow = await followRepository.findFollow(userId, mentorId);

    if (follow) {
      return res.status(200).json({
        isFollowing: follow.status === 1,
        isPending: follow.status === 0,
        status: follow.status,
      });
    } else {
      return res.status(200).json({
        isFollowing: false,
        isPending: false,
        status: null,
      });
    }
  } catch (error) {
    console.error("Check Following Error:", error.message);
    return res.status(500).json({ message: "Failed to check follow status." });
  }
};

const getPendingFollowRequests = async (req, res) => {
  try {
    const mentorId = req.user.id; // Logged-in mentor
    const pendingRequests = await followRepository.getPendingRequests(mentorId);
    return res.status(200).json({ requests: pendingRequests });
  } catch (error) {
    console.error("Get Pending Requests Error:", error.message);
    return res.status(500).json({ message: "Failed to fetch pending requests." });
  }
};

module.exports = {
  sendFollowRequest,
  unfollowMentor,
  acceptFollowRequest,
  rejectFollowRequest,
  getFollowers,
  isUserFollowingMentor,
  getPendingFollowRequests
};
