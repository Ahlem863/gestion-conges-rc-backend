const jwt = require('jsonwebtoken');

// Vérifie que le token est valide (utilisateur connecté)
exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'Token manquant' });
  }

  const token = authHeader.split(' ')[1]; // format attendu: "Bearer <token>"

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token manquant' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // on attache l'utilisateur décodé à la requête
    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Token invalide ou expiré' });
  }
};

// Vérifie que l'utilisateur a un rôle autorisé
// roleIds : tableau des role_id autorisés, ex: [2, 3] pour Chef et RH
exports.checkRole = (roleIds) => {
  return (req, res, next) => {
    if (!roleIds.includes(req.user.role_id)) {
      return res.status(403).json({ success: false, message: 'Accès refusé pour ce rôle' });
    }
    next();
  };
};