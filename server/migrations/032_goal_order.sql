-- Goals in the owner's order. Independent of 025 to 031: it touches only its
-- own column and sequence, so it runs the same whichever of them an install
-- applies first.

-- Where each goal ranks: lower comes first. Existing goals keep the order they
-- were listed in (oldest first), and a new goal takes the next number from the
-- sequence, so it joins at the end of whatever order the owner set.
CREATE SEQUENCE goal_position;
ALTER TABLE goals ADD COLUMN position bigint;
UPDATE goals g SET position = ranked.n
FROM (SELECT id, row_number() OVER (ORDER BY created_at, name) AS n FROM goals) ranked
WHERE ranked.id = g.id;
SELECT setval('goal_position', (SELECT count(*) FROM goals) + 1, false);
ALTER TABLE goals
  ALTER COLUMN position SET DEFAULT nextval('goal_position'),
  ALTER COLUMN position SET NOT NULL;
ALTER SEQUENCE goal_position OWNED BY goals.position;
