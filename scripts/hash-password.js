// Dépannage : calcule le hash d'un nouveau mot de passe pour le coller dans la base (éditeur SQL de Neon) :
//   node scripts/hash-password.js "mon nouveau mot de passe"
//   UPDATE users SET password_hash = '<résultat>' WHERE lower(email) = 'ton@email.fr';
import { hashPassword } from '../server/auth.js';
const pw = process.argv[2];
if (!pw || pw.length < 10) { console.error('Donnez un mot de passe d\'au moins 10 caractères entre guillemets.'); process.exit(1); }
console.log(await hashPassword(pw));
