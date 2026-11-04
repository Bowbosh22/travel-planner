-- Documents (billets, confirmations, factures) rangés dans la base : gratuit, sans service externe.
CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_id     uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  booking_id  uuid REFERENCES bookings(id) ON DELETE SET NULL,
  name        text NOT NULL,
  mime        text NOT NULL,
  size_bytes  integer NOT NULL CHECK (size_bytes > 0),
  data        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_trip_idx ON documents (trip_id);
CREATE INDEX documents_user_idx ON documents (user_id);

-- Coordonnées du lieu d'une réservation (carte). geo_query = le texte du lieu pour lequel elles ont été calculées :
-- si le lieu change, les anciennes coordonnées sont ignorées. lat/lng NULL avec geo_query rempli = lieu introuvable.
ALTER TABLE bookings
  ADD COLUMN lat double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  ADD COLUMN lng double precision CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  ADD COLUMN geo_query text;
