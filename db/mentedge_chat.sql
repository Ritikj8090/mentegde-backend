CREATE SCHEMA IF NOT EXISTS mentedge;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS mentedge.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id UUID NOT NULL,
  user1_role TEXT NOT NULL CHECK (user1_role IN ('user', 'mentor')),
  user2_id UUID NOT NULL,
  user2_role TEXT NOT NULL CHECK (user2_role IN ('user', 'mentor')),
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user1
  ON mentedge.chat_conversations (user1_id);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user2
  ON mentedge.chat_conversations (user2_id);

CREATE TABLE IF NOT EXISTS mentedge.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL
    REFERENCES mentedge.chat_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('user', 'mentor')),
  message TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON mentedge.chat_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS mentedge.chat_message_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL
    REFERENCES mentedge.chat_messages(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
