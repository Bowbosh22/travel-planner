ALTER TABLE users DROP CONSTRAINT IF EXISTS users_theme_color_check;
ALTER TABLE users ADD CONSTRAINT users_theme_color_check CHECK (theme_color IN ('paysage', 'bleu', 'gris', 'marron'));
ALTER TABLE users ALTER COLUMN theme_color SET DEFAULT 'paysage';
UPDATE users SET theme_color = 'paysage', theme_mode = 'sombre';
