-- The in-app chat: the one conversation an install has, and what the owner
-- told Leeway to keep in mind across conversations.

-- Only the words: what the owner asked and what Leeway answered. The tool
-- calls in between are not kept, so the history sent back to the model stays
-- small.
CREATE TABLE chat_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 20000),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Things the owner said in Chat that still matter later, saved when they
-- asked or plainly meant Leeway to remember them: "saving for a wedding in
-- June", "paid twice a month". The owner sees each one and can delete it.
CREATE TABLE coach_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
