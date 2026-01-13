function sanitizeLiveMentorEntry(entry) {
  try {
    const parsed = typeof entry === "string" ? JSON.parse(entry) : entry;
    if (!parsed || typeof parsed !== "object" || !parsed.user_id) return null;

    return {
      user_id: parsed.user_id,
      username: parsed.username || "Unknown",
      email: parsed.email || "",
      bio: parsed.bio || "",
      expertise: parsed.expertise || [],
      rating: parsed.rating || 0,
      is_live: true,
    };
  } catch {
    return null;
  }
}

module.exports = { sanitizeLiveMentorEntry };
