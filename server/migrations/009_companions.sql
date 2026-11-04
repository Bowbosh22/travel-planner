ALTER TABLE trips ADD COLUMN companions jsonb NOT NULL DEFAULT '[]'::jsonb;
