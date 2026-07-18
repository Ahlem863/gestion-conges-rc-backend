const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// INSCRIPTION (création d'un utilisateur - normalement réservé au RH)
exports.register = async (req, res) => {
  try {
    const { nom, prenom, email, mot_de_passe, role_id, departement_id, chef_id } = req.body;

    if (!nom || !prenom || !email || !mot_de_passe || !role_id || !departement_id) {
      return res.status(400).json({ success: false, message: 'Champs manquants' });
    }

    // Vérifier si l'email existe déjà
    const [existing] = await pool.query('SELECT id FROM utilisateurs WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
    }

    // Hasher le mot de passe (jamais en clair en base)
    const hash = await bcrypt.hash(mot_de_passe, 10);

    const [result] = await pool.query(
      `INSERT INTO utilisateurs (nom, prenom, email, mot_de_passe, role_id, departement_id, chef_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nom, prenom, email, hash, role_id, departement_id, chef_id || null]
    );

    res.status(201).json({ success: true, message: 'Utilisateur créé', id: result.insertId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// CONNEXION
exports.login = async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;

    if (!email || !mot_de_passe) {
      return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });
    }

    const [rows] = await pool.query('SELECT * FROM utilisateurs WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Identifiants invalides' });
    }

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(mot_de_passe, user.mot_de_passe);

    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Identifiants invalides' });
    }

    // Créer le token JWT (contient l'id et le rôle, valable 8h)
    const token = jwt.sign(
      { id: user.id, role_id: user.role_id, departement_id: user.departement_id },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        role_id: user.role_id,
        departement_id: user.departement_id
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};