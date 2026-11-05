-- Étapes d'un voyage (plusieurs destinations dans un même voyage) et logements à comparer pour chaque étape.
CREATE TABLE trip_stops (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id    uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name       text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  lat        double precision,
  lng        double precision,
  geo_query  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX trip_stops_trip_idx ON trip_stops (trip_id, start_date);

ALTER TABLE bookings ADD COLUMN stop_id uuid REFERENCES trip_stops(id) ON DELETE SET NULL;
CREATE INDEX bookings_stop_idx ON bookings (stop_id);

CREATE TABLE stay_options (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  stop_id         uuid NOT NULL REFERENCES trip_stops(id) ON DELETE CASCADE,
  url             text,
  name            text NOT NULL,
  location        text,
  currency        text NOT NULL DEFAULT 'EUR',
  original_amount numeric(14,2),
  amount_eur      numeric(14,2),
  fx_rate         numeric,
  fx_date         date,
  fx_source       text,
  rating          numeric(3,1),
  notes           text,
  booking_id      uuid REFERENCES bookings(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stay_options_stop_idx ON stay_options (stop_id);
