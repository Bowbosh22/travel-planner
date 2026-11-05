# Travel Planner

Application web pour organiser ses voyages et suivre son budget en euros.

**État : étape 8 sur 8 (terminé)** — page Budget, simulateur et alerte de dépassement, devises converties en euros (taux figés), import intelligent par lien, comptes (email + mot de passe, « se souvenir de moi »), voyages, réservations et paiements enregistrés dans PostgreSQL, dashboard branché sur vos vraies données, thèmes (bleu / gris / marron, clair / sombre).

## Lancer en local

Il faut une base PostgreSQL. Les variables d'environnement sont listées dans `.env.example` (le fichier `.env` n'est pas lu automatiquement : passez-les sur la ligne de commande) :

```bash
npm install
DATABASE_URL=postgres://utilisateur:motdepasse@localhost:5432/travel_planner npm start
```

Les tables sont créées automatiquement au démarrage (`server/migrations/`). Puis ouvrir http://localhost:3000.

Tests : `npm test` (calculs budgétaires). Les tests de l'API tournent aussi si vous fournissez une base **vide dédiée aux tests** :
`TEST_DATABASE_URL=postgres://... npm test` (⚠ cette base est effacée à chaque lancement).

## Devises

Chaque réservation garde son **montant d'origine**, sa **devise** et le **taux figé** au jour de l'enregistrement ; le budget, les graphiques et les alertes travaillent en euros. Le taux ne bouge plus ensuite, même si le marché évolue : modifier le montant garde le même taux. Il change seulement si vous changez de devise, saisissez un taux à la main ou cochez « Actualiser le taux ».

- Franc CFA (XAF et XOF) : parité fixe officielle, 1 € = 655,957 F CFA, sans appel réseau.
- Devises gérées : **euro, dollar américain (USD) et franc CFA (XAF, XOF)**, volontairement. Dollar : BCE via Frankfurter, puis API communautaire currency-api (jsDelivr, puis pages.dev) en secours. Chaque taux du jour est mémorisé (table `fx_rates`) ; si toutes les sources sont en panne, le dernier taux connu des 10 derniers jours est utilisé et daté, sinon une erreur invite à saisir le taux à la main.
- Paiements : saisis dans la devise de la réservation, convertis au taux figé de la réservation. Le dernier paiement qui solde la réservation reprend exactement son montant en euros (aucun écart d'un centime).
- Devise non modifiable tant que la réservation a des paiements.

## Import par lien

Bouton « Importer depuis un lien » : l'adresse d'une page (hôtel, restaurant, activité, vol...) est lue par le serveur, qui en extrait **uniquement ce qui y est écrit** (données structurées JSON-LD, puis Open Graph, puis titre). Un écran de vérification s'affiche avant tout ajout ; un champ introuvable reste vide, rien n'est deviné.

- Prix trouvé dans une devise gérée : montant et devise préremplis, converti en euros avec un taux figé. Devise absente ou non gérée : signalé, jamais pris pour des euros.
- Captcha, connexion obligatoire, limite d'accès : le site est signalé comme non lisible, **jamais contourné**. Beaucoup de grandes plateformes de réservation refusent les robots : saisissez alors la réservation à la main (le lien peut être conservé).
- Sécurité : seules les adresses http/https des ports 80/443 sont acceptées ; réseau privé, localhost et adresses de métadonnées cloud sont refusés à chaque redirection et à la connexion réelle ; taille (1,5 Mo), durée (8 s) et redirections (4) limitées ; 10 analyses par minute et par utilisateur.

## Budget, simulateur et alerte de dépassement

- **Budget** : budget initial, prévisionnel, payé, reste à payer et disponible ; détail par catégorie ; repères par voyageur et par nuit ; quatre graphiques ; alertes. Tout se met à jour avec les réservations et paiements.
- **Simulateur** : retirer des réservations (ou une catégorie), saisir un autre montant, appliquer une variation en %, changer le budget, ajouter une dépense hypothétique. **Rien n'est enregistré** ; les paiements déjà faits restent réels.
- **Dépassement** : quand le budget est dépassé, un bandeau rouge s'affiche en haut du dashboard, des réservations et du budget (masquable, il réapparaît si le dépassement augmente) et un avertissement apparaît dès qu'une action fait dépasser ou aggrave le dépassement.

## Documents, planning et carte

- **Documents** : billets, confirmations et factures (PDF, JPG, PNG, WebP, 5 Mo par fichier, 200 Mo par compte), liés à une réservation ou au voyage. Ils sont rangés dans la base PostgreSQL : gratuit, aucun service en plus (Cloudflare R2 demande une carte bancaire). Le type est déterminé par le **contenu** du fichier, jamais par son nom ; les images sont servies sous restrictions strictes ; chaque fichier n'est accessible qu'à son propriétaire. Le stockage est isolé dans `server/storage/documents.js` : un autre stockage pourra le remplacer.
- **Planning** : calendrier mensuel ou vue jour par jour avec les réservations datées et les paiements ; les réservations sans date sont listées à part.
- **Carte** : Leaflet + OpenStreetMap (gratuit, sans compte). Le lieu de chaque réservation est converti en coordonnées par Nominatim (une requête par seconde maximum, résultat mémorisé : un lieu n'est cherché qu'une fois). Lieu introuvable = signalé, jamais deviné.

## Sécurité

- **Comptes** : mots de passe hachés (scrypt), sessions stockées sous forme d'empreinte, cookie `httpOnly` + `SameSite=Lax` (+ `Secure` en production), « se souvenir de moi » = 30 jours sinon session. Anti force brute par email+adresse et par adresse seule ; inscriptions limitées à 10 par heure et par adresse, fermables avec `ALLOW_REGISTRATION=false`.
- **Requêtes** : protection CSRF (en-tête dédié + même origine), requêtes SQL toutes paramétrées, données filtrées par utilisateur sur chaque route (isolation testée), 300 écritures par minute et par utilisateur au maximum, envois de fichiers (30/min), recherches de lieux (70/min) et analyses de liens (10/min) limités.
- **Navigateur** : CSP stricte sans script en ligne, `frame-ancestors 'none'`, API jamais mise en cache, capteurs (caméra, micro, position) désactivés, tout texte venant d'un site tiers affiché échappé.
- **Fichiers** : type déterminé par le contenu, 5 Mo maximum, images servies avec `sandbox`, téléchargement avec `nosniff`.
- **Import par lien** : anti-SSRF (voir plus haut). **Favori** : données revalidées à la réception.
- **Maintenance** : sessions expirées purgées chaque heure, arrêt propre au redéploiement, `npm audit` sans vulnérabilité connue au moment de la livraison.
- **Secrets** : uniquement dans les variables d'environnement de Render, jamais dans le code ni dans GitHub. Gardez le dépôt GitHub en privé.

## Favori d'import (Airbnb, Booking...)

Paramètres → « Importer depuis mon navigateur » : on glisse un bouton dans la barre de favoris. Sur une annonce ouverte dans **votre** navigateur (dates choisies), un clic lit ce qui est affiché (nom, lieu, total avec devise, dates de l'adresse) et ouvre Travel Planner avec une réservation préremplie à vérifier. Les données passent dans la partie `#` de l'adresse (jamais envoyée à un serveur) et sont revalidées à la réception. Champ introuvable = champ vide ; un prix « par nuit » n'est jamais pris pour le total ; une devise ambiguë (« $ » seul) est à choisir.

## Structure

```
server/index.js          Démarrage : migrations puis serveur
server/app.js            Express : sécurité (helmet, CSRF), API, fichiers statiques
server/ratelimit.js      Limiteur de débit
server/auth.js           Inscription, connexion, sessions (cookie httpOnly), anti force brute
server/routes/trips.js   Voyages, réservations, paiements (toujours filtrés par utilisateur)
server/routes/import.js  Route d'import par lien
server/importer/         Lecture sécurisée (anti-SSRF), extraction JSON-LD / Open Graph
server/fx/rates.js       Taux de change, parités fixes, cache, secours
server/routes/fx.js      Liste des devises et aperçu du taux
server/routes/documents.js  Documents (envoi, liste, téléchargement, suppression)
server/storage/          Stockage des documents (dans PostgreSQL)
server/routes/geo.js     Coordonnées des lieux (carte)
server/geo/nominatim.js  Géocodage OpenStreetMap, une requête par seconde
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
test/api.test.js         Tests de l'API (auth, isolation entre comptes, paiements, import)
test/fx.test.js          Taux de change (sources, secours, cache, valeurs absurdes)
test/capture.test.js     Favori d'import (lecture de la page, revalidation)
test/simulation.test.js  Simulateur et avis de dépassement
test/planning.test.js    Planning jour par jour
test/ssrf.test.js        Adresses interdites (privées, locales, écritures déguisées)
test/extract.test.js     Extraction des informations d'une page
test/import.test.js      Import sur de faux sites (captcha, redirections, pages géantes...)
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

## Disposition du tableau de bord

Barre de navigation flottante à gauche (icônes seules, nom au survol), en-tête avec salutation, choix du voyage, import et avatar, puis bloc voyage à gauche, budget (anneau) et prochaines réservations à droite, et trois cartes en bas : catégories, carte du voyage, prévu/payé. Sur mobile, la barre d'onglets du bas est conservée et tout passe sur une colonne.

Thème « Paysage » (par défaut) : fond de montagnes dans la brume et cartes en verre dépoli. Les thèmes Bleu, Gris et Marron restent disponibles dans Paramètres. La migration 005 s'applique toute seule au démarrage.

## Photos de la destination

À la création d'un voyage (ou au changement de destination ou de pays), le serveur cherche jusqu'à 6 photos de la ville sur **Unsplash** (gratuit). Sur l'accueil, une photo différente s'affiche à chaque visite, puis elles se fondent l'une dans l'autre toutes les 9 secondes. Le nom du photographe est affiché avec un lien, comme l'exige Unsplash.

- Clé gratuite : créer une application sur unsplash.com/developers, copier l'**Access Key** et l'ajouter dans Render > Environment sous le nom `UNSPLASH_ACCESS_KEY`. Elle ne doit jamais être dans le code ni sur GitHub.
- Sans clé, ou si Unsplash ne répond pas, le site retombe sur une photo Wikipédia (sans clé).
- Si aucune photo n'est trouvée, le bouton « Chercher une photo » permet de réessayer et affiche la raison de l'échec.
- Migrations 006 et 007 (appliquées au démarrage).

## Heure et météo de la destination

Une mini-carte de l'accueil affiche l'heure locale et la météo actuelle de la ville (Open-Meteo, gratuit, sans clé ; interrogé par le serveur, résultat gardé 20 minutes). Si le service ne répond pas, elle affiche « Météo indisponible ». La mini-carte voisine indique avec combien de personnes vous voyagez (d'après le nombre de voyageurs du voyage).

## Carte du voyage (accueil)

Deux vues sur la même carte : **Trajet aérien** (arc de grand cercle entre la ville de départ et la destination, avec distance et durée de vol approximatives) et **Pays** (carte du pays de destination, avec les lieux de vos réservations). La ville de départ se renseigne dans « Mes voyages » ; sans elle, seule la vue Pays est complète. Coordonnées calculées avec Nominatim/OpenStreetMap (gratuit) puis mémorisées par voyage (migration 008).

## Personnes qui voyagent avec vous

Dans la mini-carte « Voyage avec » de l'accueil, le bouton « + » permet d'ajouter une personne par son prénom (Entrée pour valider, Échap pour annuler) ; le × retire un prénom, et « +N » déplie la liste. 20 prénoms au maximum, sans doublon. Le nombre de voyageurs du voyage s'ajuste automatiquement (il ne descend jamais sous 1 + le nombre de prénoms). Migration 009.


## Voyages partagés (lien d'invitation)

- Le propriétaire clique sur **Partager** (carte du voyage ou widget « Voyage avec ») et crée un lien d'invitation.
- Toute personne qui ouvre le lien et **crée un compte** (ou se connecte) rejoint le voyage : réservations, paiements, documents, dates, budget… tout est commun.
- Seul le propriétaire peut **supprimer** le voyage, gérer/désactiver le lien et retirer des participants. Un participant peut **quitter** le voyage.
- Les prénoms des participants apparaissent automatiquement dans « Voyage avec ».
- Avec `ALLOW_REGISTRATION=false`, l'inscription publique reste fermée : elle n'est possible qu'avec un lien d'invitation valide.
- Maximum 20 participants par voyage. « Nouveau lien » ou « Désactiver » invalide l'ancien lien.
- La migration `010_trip_sharing.sql` s'applique automatiquement au démarrage.


## Mot de passe oublié (codes de récupération)

- À la création du compte, 8 codes de récupération (`XXXXX-XXXXX`) sont affichés **une seule fois**. Chaque code ne sert qu'une fois.
- Écran de connexion → « Mot de passe oublié ? » : e-mail + un code + nouveau mot de passe. Toutes les sessions ouvertes sont alors fermées.
- Comptes existants : Paramètres → « Mot de passe oublié ? » → « Générer de nouveaux codes » (demande le mot de passe actuel ; les anciens codes sont invalidés).
- Les codes sont stockés hachés ; essais limités (5 échecs par e-mail, 20 par adresse IP).
- Secours si plus aucun code : `node scripts/hash-password.js "nouveau mot de passe"` affiche un hash ; dans la console SQL de Neon :
  `UPDATE users SET password_hash = '<hash>' WHERE lower(email) = 'votre@email';` puis supprimer les sessions : `DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE lower(email)='votre@email');`
- Migration `011_recovery_codes.sql` appliquée automatiquement au démarrage.


## Paramètres : préférences, appareils, tableau de bord personnalisable

- **Affichage du site** : mode, couleur, fond d'écran, taille du texte (petite / normale / grande), devise d'affichage (euro, dollar US, franc CFA : les montants restent enregistrés en euros, seul l'affichage est converti), page affichée au lancement (Dashboard, Mes voyages, Carte).
- **Mon compte** : prénom, mot de passe, codes de récupération, voyageurs de mes voyages (retrait réservé au créateur), **appareils connectés** (déconnexion d'un appareil ou de tous les autres), déconnexion.
- **Dashboard** : bouton « Personnaliser » : déplacer (← →), taille S / M / L / XL, masquer ou réafficher chaque widget ; « Disposition d'origine » pour tout remettre. Enregistré sur le compte.
- Préférences stockées dans `users.prefs` (liste blanche côté serveur) ; appareils : `sessions.id / user_agent / last_seen_at`. Migration `012_prefs_sessions.sql` appliquée automatiquement au démarrage.
- **Fluidité** : les lectures de l'API sont mises en cache 30 s côté navigateur (vidées à chaque écriture), les données du voyage affiché sont préchargées au survol d'un onglet, une barre de progression s'affiche pendant le chargement d'une page, et Paramètres → « Effets visuels : Légers » supprime le flou de verre dépoli.

## Mini destinations d'un voyage (ex. plusieurs villes en Malaisie)

Page **Mini destinations** : chaque étape a ses dates, son nombre de nuits, un décompte, son budget (réservations rattachées), sa carte et un **comparateur de logements trié par prix** (liens importés, prix par nuit, note, « Retenir » crée la réservation de logement). Une réservation se rattache à une étape depuis son formulaire. Migration `013_stops_stays.sql` appliquée automatiquement. Devise ajoutée : ringgit malaisien (MYR).
