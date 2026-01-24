CREATE SCHEMA IF NOT EXISTS mentedge;

CREATE TABLE IF NOT EXISTS mentedge.internship_chat_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internship_id UUID NOT NULL REFERENCES mentedge.internships(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('general', 'tech', 'management')),
  name TEXT NOT NULL,
  domain_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT internship_chat_channels_unique UNIQUE (internship_id, channel_type)
);

CREATE TABLE IF NOT EXISTS mentedge.internship_chat_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES mentedge.internship_chat_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('user', 'mentor')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT internship_chat_members_unique UNIQUE (channel_id, user_id, user_role)
);

CREATE TABLE IF NOT EXISTS mentedge.internship_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES mentedge.internship_chat_channels(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('user', 'mentor')),
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS internship_chat_messages_channel_idx
  ON mentedge.internship_chat_messages (channel_id, created_at);

CREATE TABLE IF NOT EXISTS mentedge.internship_chat_message_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES mentedge.internship_chat_messages(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
