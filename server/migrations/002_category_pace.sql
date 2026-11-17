-- Bills paid once a period (rent, insurance) should not warn about pace.
ALTER TABLE categories ADD COLUMN track_pace boolean NOT NULL DEFAULT true;
