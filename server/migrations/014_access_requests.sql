-- Demandes d'accès : une personne demande un compte, le propriétaire du site l'approuve ou la refuse.
-- Le mot de passe choisi est stocké haché (jamais en clair) et ne devient un compte qu'à l'approbation.
CREATE TABLE access_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  first_name    text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX access_requests_email_key ON access_requests (lower(email));
