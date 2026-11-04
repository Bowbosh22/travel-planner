-- Schéma initial. Tous les montants sont en euros (la conversion de devises arrive à l'étape 5).

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  first_name    text NOT NULL,
  password_hash text NOT NULL,
  theme_color   text NOT NULL DEFAULT 'bleu' CHECK (theme_color IN ('bleu', 'gris', 'marron')),
  theme_mode    text NOT NULL DEFAULT 'clair' CHECK (theme_mode IN ('clair', 'sombre', 'auto')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Seul le hash SHA-256 du jeton est stocké : une fuite de la base ne donne pas de session valide.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE trips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  destination text NOT NULL,
  country     text NOT NULL DEFAULT '',
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  travelers   integer NOT NULL DEFAULT 1 CHECK (travelers BETWEEN 1 AND 50),
  budget_eur  numeric(12, 2) NOT NULL DEFAULT 0 CHECK (budget_eur >= 0),
  plan_status text NOT NULL DEFAULT 'preparation' CHECK (plan_status IN ('preparation', 'confirme')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX trips_user_idx ON trips (user_id, start_date);

CREATE TABLE bookings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  category   text NOT NULL CHECK (category IN ('billets','logement','transport','restaurants','activites','shopping','documents','autres')),
  name       text NOT NULL,
  amount_eur numeric(12, 2) CHECK (amount_eur IS NULL OR amount_eur >= 0),
  status     text NOT NULL DEFAULT 'a_reserver' CHECK (status IN ('reserve', 'a_reserver', 'annule')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookings_trip_idx ON bookings (trip_id);

CREATE TABLE payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  paid_on    date NOT NULL,
  amount_eur numeric(12, 2) NOT NULL CHECK (amount_eur > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_booking_idx ON payments (booking_id);
