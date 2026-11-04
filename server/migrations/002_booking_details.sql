-- Détails optionnels d'une réservation (alimentent l'import par lien, puis le planning et la carte).
ALTER TABLE bookings
  ADD COLUMN source_url text,
  ADD COLUMN starts_on  date,
  ADD COLUMN ends_on    date,
  ADD COLUMN location   text,
  ADD CONSTRAINT bookings_dates_check CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on);
