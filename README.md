# Travel Planner

Application web pour organiser ses voyages et suivre son budget en euros.

**État : étape 3 sur 8** — comptes (email + mot de passe, « se souvenir de moi »), voyages, réservations et paiements enregistrés dans PostgreSQL, dashboard branché sur vos vraies données, thèmes (bleu / gris / marron, clair / sombre).

## Lancer en local

Il faut une base PostgreSQL. Les variables d'environnement sont listées dans `.env.example` (le fichier `.env` n'est pas lu automatiquement : passez-les sur la ligne de commande) :

```bash
npm install
DATABASE_URL=postgres://utilisateur:motdepasse@localhost:5432/travel_planner npm start
```

Les tables sont créées automatiquement au démarrage (`server/migrations/`). Puis ouvrir http://localhost:3000.

Tests : `npm test` (calculs budgétaires). Les tests de l'API tournent aussi si vous fournissez une base **vide dédiée aux tests** :
`TEST_DATABASE_URL=postgres://... npm test` (⚠ cette base est effacée à chaque lancement).

## Structure

```
server/index.js          Démarrage : migrations puis serveur
server/app.js            Express : sécurité (helmet, CSRF), API, fichiers statiques
server/auth.js           Inscription, connexion, sessions (cookie httpOnly), anti force brute
server/routes/trips.js   Voyages, réservations, paiements (toujours filtrés par utilisateur)
server/migrations/       Schéma SQL versionné
client/
  index.html             Coquille de l'application
  css/tokens.css         Thèmes (variables de couleur)
  css/app.css            Mise en page et composants
  js/main.js             Démarrage et routage (#/ , #/voyages, ...)
  js/nav.js              Liste des sections
  js/api.js              Accès aux données (étape 3 : appels au backend)
  js/services/budget.js  Calculs : prévisionnel, payé, reste, disponible, alertes
  js/components/         Navigation, graphiques Chart.js, notifications
  js/pages/              Dashboard, Paramètres (Apparence), sections à venir
test/budget.test.js      Tests des règles budgétaires
test/api.test.js         Tests de l'API (auth, isolation entre comptes, paiements)
```

## Déploiement gratuit : Render + Neon

1. **Base** : créer un projet sur neon.com (sans carte bancaire), copier l'adresse de connexion (« Connection string », elle contient `sslmode=require`).
2. **Application** : sur render.com, New → Web Service → choisir le dépôt GitHub. Build : `npm install`, Start : `npm start`, offre **Free**.
3. Variables d'environnement : `DATABASE_URL` (adresse Neon), `NODE_ENV=production`, et plus tard `ALLOW_REGISTRATION=false`.

Limites du gratuit : l'application s'endort après 15 min sans visite (la première page met environ une minute à se réveiller) et la base Neon se met en veille après 5 min d'inactivité (réveil en une ou deux secondes). Vos données ne sont pas effacées.

## Déploiement Railway (payant)

1. Dans le projet Railway, ajouter un service **PostgreSQL** (New → Database → PostgreSQL).
2. Dans le service de l'application, onglet Variables :
   - `DATABASE_URL` = référence à la variable `DATABASE_URL` du service PostgreSQL
   - `NODE_ENV` = `production`
   - `ALLOW_REGISTRATION` = `false` une fois votre compte créé (facultatif : ferme les inscriptions)
3. Commande de démarrage : `npm start`. Railway fournit `PORT` automatiquement.

Ne mettez jamais de mot de passe ou d'adresse de base dans le code ni dans GitHub : uniquement dans les variables Railway.
