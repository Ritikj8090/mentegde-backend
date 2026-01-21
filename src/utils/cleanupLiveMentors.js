// background/cleanupLiveMentors.js
const client = require("../config/redis");

const cleanupLiveMentors = async () => {
  if (!client.isOpen) await client.connect();

  const allMentors = await client.lRange("liveMentors", 0, -1);
  for (const entry of allMentors) {
    const mentor = JSON.parse(entry);
    const exists = await client.exists(`mentor:${mentor.user_id}`);
    if (!exists) {
      // TTL expired but still in list: remove
      await client.lRem("liveMentors", 0, entry);
      console.log(
        `🧹 Removed expired mentor ${mentor.user_id} from liveMentors`
      );
    }
  }
};

module.exports = cleanupLiveMentors;
