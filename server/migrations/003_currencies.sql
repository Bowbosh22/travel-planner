-- Devises : on garde le montant d'ORIGINE et le taux FIGÉ au jour de l'enregistrement.
-- amount_eur reste le montant en euros calculé une fois pour toutes (budget et graphiques s'appuient dessus).
-- fx_rate = nombre d'unités de la devise pour 1 euro (ex. 655.957 pour le franc CFA).

CREATE TABLE fx_rates (
  currency  text NOT NULL,
  day       date NOT NULL,          -- jour de la demande
  rate      numeric(20, 8) NOT NULL CHECK (rate > 0),
  rate_date date NOT NULL,          -- date réelle du taux chez la source (ex. dernier jour ouvré)
  source    text NOT NULL,
  PRIMARY KEY (currency, day)
);

ALTER TABLE bookings
  ADD COLUMN currency        text NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN original_amount numeric(14, 2) CHECK (original_amount IS NULL OR original_amount >= 0),
  ADD COLUMN fx_rate         numeric(20, 8) NOT NULL DEFAULT 1 CHECK (fx_rate > 0),
  ADD COLUMN fx_date         date,
  ADD COLUMN fx_source       text;
UPDATE bookings SET original_amount = amount_eur, fx_date = created_at::date, fx_source = 'EUR';

ALTER TABLE payments ADD COLUMN original_amount numeric(14, 2);
UPDATE payments SET original_amount = amount_eur;
ALTER TABLE payments ALTER COLUMN original_amount SET NOT NULL;
ALTER TABLE payments ADD CONSTRAINT payments_original_positive CHECK (original_amount > 0);
-- Un très petit paiement dans une devise faible peut valoir 0,00 € après arrondi.
ALTER TABLE payments DROP CONSTRAINT payments_amount_eur_check;
ALTER TABLE payments ADD CONSTRAINT payments_amount_eur_check CHECK (amount_eur >= 0);
