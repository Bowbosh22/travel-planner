# Travel Planner

Application web pour organiser ses voyages et suivre son budget en euros.

**État : étape 2 sur 8** — dashboard, navigation, thèmes (bleu / gris / marron, clair / sombre).
Les données affichées sont des **exemples** (`client/js/data/mock-db.js`). La base PostgreSQL arrive à l'étape 3.

## Lancer en local

```bash
npm install
npm start
```

Puis ouvrir http://localhost:3000. Tests des calculs budgétaires : `npm test`.

## Structure

```
server/index.js          Express : fichiers statiques, en-têtes de sécurité (helmet), /api/health
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
```

## Déploiement Railway

Variables : `NODE_ENV=production`. Railway fournit `PORT` automatiquement.
Commande de démarrage : `npm start`.
