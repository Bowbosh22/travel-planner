-- Une réservation « détachée du budget » reste dans la liste (ex. logement envisagé) mais ne compte plus dans les totaux.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS in_budget boolean NOT NULL DEFAULT true;
