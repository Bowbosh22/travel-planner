// Limiteur de débit simple en mémoire (une seule instance de serveur) : max requêtes par fenêtre et par clé.
// Par défaut la clé est l'utilisateur connecté, sinon l'adresse IP.
export function rateLimit({ max, windowMs, key = (req) => req.user?.id ?? req.ip, message = 'Trop de requêtes. Réessayez dans un instant.', now = Date.now }) {
  const hits = new Map();
  return (req, res, next) => {
    const t = now();
    const k = key(req);
    const recent = (hits.get(k) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }
    recent.push(t);
    hits.set(k, recent);
    if (hits.size > 5000) for (const [kk, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(kk);
    return next();
  };
}
