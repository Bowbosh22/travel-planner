-- Voyages partagés : le propriétaire reste trips.user_id ; les invités sont dans trip_members.
CREATE TABLE trip_members (
  trip_id   uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, user_id)
);
CREATE INDEX trip_members_user_idx ON trip_members (user_id);

-- Lien d'invitation secret (un seul actif par voyage ; NULL = aucun lien).
ALTER TABLE trips ADD COLUMN invite_token text UNIQUE;
