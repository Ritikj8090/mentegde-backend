const db = require("../config/db");

const CHANNELS = [
  { type: "general", name: "General", domain: null },
  { type: "tech", name: "Tech", domain: "tech" },
  { type: "management", name: "Management", domain: "management" },
];

const ensureChannels = async (client, internshipId) => {
  for (const channel of CHANNELS) {
    await client.query(
      `
      INSERT INTO mentedge.internship_chat_channels (
        internship_id, channel_type, name, domain_name
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (internship_id, channel_type) DO NOTHING
      `,
      [internshipId, channel.type, channel.name, channel.domain]
    );
  }
};

const getChannelId = async (client, internshipId, channelType) => {
  const result = await client.query(
    `
    SELECT id
    FROM mentedge.internship_chat_channels
    WHERE internship_id = $1 AND channel_type = $2
    LIMIT 1
    `,
    [internshipId, channelType]
  );
  return result.rows[0]?.id || null;
};

const addMemberToChannel = async (client, channelId, userId, userRole) => {
  await client.query(
    `
    INSERT INTO mentedge.internship_chat_members (
      channel_id, user_id, user_role
    )
    VALUES ($1, $2, $3)
    ON CONFLICT (channel_id, user_id, user_role) DO NOTHING
    `,
    [channelId, userId, userRole]
  );
};

const addMemberToInternshipChannels = async (
  client,
  internshipId,
  userId,
  userRole,
  domainName
) => {
  await ensureChannels(client, internshipId);

  const generalId = await getChannelId(client, internshipId, "general");
  if (generalId) {
    await addMemberToChannel(client, generalId, userId, userRole);
  }

  if (domainName === "tech" || domainName === "management") {
    const channelId = await getChannelId(client, internshipId, domainName);
    if (channelId) {
      await addMemberToChannel(client, channelId, userId, userRole);
    }
  }
};

const listChannelsForInternship = async (internshipId) => {
  const result = await db.query(
    `
    SELECT id, channel_type, name, domain_name, created_at
    FROM mentedge.internship_chat_channels
    WHERE internship_id = $1
    ORDER BY
      CASE channel_type
        WHEN 'general' THEN 1
        WHEN 'tech' THEN 2
        WHEN 'management' THEN 3
        ELSE 4
      END
    `,
    [internshipId]
  );
  return result.rows;
};

module.exports = {
  ensureChannels,
  addMemberToInternshipChannels,
  listChannelsForInternship,
  getChannelId,
  addMemberToChannel,
};
