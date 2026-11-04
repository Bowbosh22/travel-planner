ALTER TABLE trips ADD COLUMN photos jsonb NOT NULL DEFAULT '[]'::jsonb;
