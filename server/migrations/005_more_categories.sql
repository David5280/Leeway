-- A fuller starter set: category groups, and a record of one-time upgrades.

-- An optional heading a category is listed under ("Food and drink"), so a
-- longer list of specific categories stays easy to scan. Purely for display.
ALTER TABLE categories ADD COLUMN group_name text CHECK (length(group_name) BETWEEN 1 AND 40);

-- One-time data upgrades that run in code at startup (see
-- server/src/domain/starterUpgrade.ts), recorded so each runs once per
-- install. Unlike a migration, an upgrade only touches the owner's data
-- where it is safe to, and is skipped entirely where it is not.
CREATE TABLE applied_upgrades (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
