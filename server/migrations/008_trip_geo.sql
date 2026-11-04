ALTER TABLE trips ADD COLUMN origin text NOT NULL DEFAULT '', ADD COLUMN geo_key text, ADD COLUMN geo jsonb;
