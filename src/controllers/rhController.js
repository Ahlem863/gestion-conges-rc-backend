const bcrypt = require('bcryptjs');
const pool = require('../config/db');

// Lister tous les utilisateurs (avec leur rôle et département)
exports.getUtilisateurs = async (req, res) => {
  try {
    let query = `SELECT u.id, u.matricule, u.nom, u.prenom, u.email, u.actif, u.created_at,
                        r.nom AS role, d.nom AS departement, u.chef_id, u.departement_id
                 FROM utilisateurs u
                 JOIN roles r ON u.role_id = r.id
                 JOIN departements d ON u.departement_id = d.id`;
    let params = [];

    if (req.user.role_id === 2) {
      query += ` WHERE u.departement_id = (SELECT departement_id FROM utilisateurs WHERE id = ?) AND r.nom = 'Employe'`;
      params = [req.user.id];
    }

    query += ` ORDER BY u.nom ASC`;

    const [rows] = await pool.query(query, params);
    res.json({ success: true, utilisateurs: rows });
  } catch (error) {
    console.error('Erreur getUtilisateurs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.creerUtilisateur = async (req, res) => {
  try {
    const { matricule, nom, prenom, email, mot_de_passe, role_id, departement_id, chef_id } = req.body;

    if (!nom || !prenom || !email || !mot_de_passe || !role_id || !departement_id) {
      return res.status(400).json({ success: false, message: 'Champs manquants' });
    }

    const [existing] = await pool.query('SELECT id FROM utilisateurs WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Email déjà utilisé' });
    }

    const hash = await bcrypt.hash(mot_de_passe, 10);

    const [result] = await pool.query(
      `INSERT INTO utilisateurs (matricule, nom, prenom, email, mot_de_passe, role_id, departement_id, chef_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [matricule || null, nom, prenom, email, hash, role_id, departement_id, chef_id || null]
    );

    res.status(201).json({ success: true, message: 'Utilisateur créé', id: result.insertId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.toggleActif = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT actif FROM utilisateurs WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    }

    const nouveauStatut = rows[0].actif ? 0 : 1;
    await pool.query('UPDATE utilisateurs SET actif = ? WHERE id = ?', [nouveauStatut, id]);

    res.json({ success: true, message: `Utilisateur ${nouveauStatut ? 'activé' : 'désactivé'}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.modifierUtilisateur = async (req, res) => {
  try {
    const { id } = req.params;
    const { matricule, nom, prenom, email, role_id, departement_id, nouveau_mot_de_passe } = req.body;

    await pool.query(
      `UPDATE utilisateurs SET matricule = ?, nom = ?, prenom = ?, email = ?, role_id = ?, departement_id = ? WHERE id = ?`,
      [matricule, nom, prenom, email, role_id, departement_id, id]
    );

    if (nouveau_mot_de_passe && nouveau_mot_de_passe.trim() !== '') {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash(nouveau_mot_de_passe, 10);
      await pool.query(`UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?`, [hash, id]);
    }

    res.json({ success: true, message: 'Utilisateur modifié' });
  } catch (error) {
    console.error('Erreur modifierUtilisateur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getDepartements = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM departements ORDER BY nom ASC');
    res.json({ success: true, departements: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.creerDepartement = async (req, res) => {
  try {
    const { nom } = req.body;
    if (!nom) return res.status(400).json({ success: false, message: 'Nom requis' });

    const [result] = await pool.query('INSERT INTO departements (nom) VALUES (?)', [nom]);
    res.status(201).json({ success: true, message: 'Département créé', id: result.insertId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getStatistiques = async (req, res) => {
  try {
    const [parStatut] = await pool.query(
      `SELECT statut, COUNT(*) AS total FROM rc GROUP BY statut`
    );

    const [parDepartement] = await pool.query(
      `SELECT d.nom AS departement, COUNT(rc.id) AS total_rc
       FROM rc
       JOIN utilisateurs u ON rc.utilisateur_id = u.id
       JOIN departements d ON u.departement_id = d.id
       GROUP BY d.nom`
    );

    const [totaux] = await pool.query(
      `SELECT 
         (SELECT COUNT(*) FROM utilisateurs WHERE actif = 1) AS total_employes,
         (SELECT COUNT(*) FROM rc WHERE statut = 'Disponible') AS rc_disponibles,
         (SELECT COUNT(*) FROM rc WHERE statut = 'En attente') AS rc_en_attente,
         (SELECT COUNT(*) FROM rc WHERE statut = 'Expiré') AS rc_expires`
    );

    res.json({
      success: true,
      par_statut: parStatut,
      par_departement: parDepartement,
      totaux: totaux[0]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getRCParEmploye = async (req, res) => {
  try {
    let query = `SELECT u.id, u.matricule, u.nom, u.prenom, d.nom AS departement,
                        COUNT(CASE WHEN rc.statut = 'Disponible' THEN 1 END) AS solde_rc
                 FROM utilisateurs u
                 JOIN departements d ON u.departement_id = d.id
                 LEFT JOIN rc ON rc.utilisateur_id = u.id
                 WHERE u.actif = 1`;
    let params = [];

    if (req.user.role_id === 2) {
      query += ` AND u.departement_id = (SELECT departement_id FROM utilisateurs WHERE id = ?)`;
      params = [req.user.id];
    }

    query += ` GROUP BY u.id, u.matricule, u.nom, u.prenom, d.nom ORDER BY u.nom ASC`;

    const [rows] = await pool.query(query, params);
    res.json({ success: true, employes: rows });
  } catch (error) {
    console.error('Erreur getRCParEmploye:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Statistiques : nombre de jours RC par structure, regroupés par mois/trimestre/année
exports.getStatistiquesStructure = async (req, res) => {
  try {
    const periode = req.query.periode || 'mois'; // 'mois' | 'trimestre' | 'annee'

    let periodeExpr;
    if (periode === 'annee') {
      periodeExpr = `YEAR(rc.date_travail)`;
    } else if (periode === 'trimestre') {
      periodeExpr = `CONCAT(YEAR(rc.date_travail), '-T', QUARTER(rc.date_travail))`;
    } else {
      periodeExpr = `DATE_FORMAT(rc.date_travail, '%Y-%m')`;
    }

    const [rows] = await pool.query(
      `SELECT d.nom AS structure, ${periodeExpr} AS periode, COUNT(rc.id) AS nombre_jours
       FROM rc
       JOIN utilisateurs u ON rc.utilisateur_id = u.id
       JOIN departements d ON u.departement_id = d.id
       WHERE rc.statut IN ('Disponible', 'Utilisé', 'Expiré', 'Validé Chef', 'En attente')
       GROUP BY d.nom, periode
       ORDER BY periode DESC, d.nom ASC`
    );

    res.json({ success: true, periode, donnees: rows });
  } catch (error) {
    console.error('Erreur getStatistiquesStructure:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Statistiques : nombre de jours RC par employé, au sein de chaque structure, regroupés par mois/trimestre/année
// Utilisé pour le détail dépliable sous chaque ligne de structure dans la page Statistiques
exports.getStatistiquesEmployes = async (req, res) => {
  try {
    const periode = req.query.periode || 'mois'; // 'mois' | 'trimestre' | 'annee'

    let periodeExpr;
    if (periode === 'annee') {
      periodeExpr = `YEAR(rc.date_travail)`;
    } else if (periode === 'trimestre') {
      periodeExpr = `CONCAT(YEAR(rc.date_travail), '-T', QUARTER(rc.date_travail))`;
    } else {
      periodeExpr = `DATE_FORMAT(rc.date_travail, '%Y-%m')`;
    }

    const [rows] = await pool.query(
      `SELECT d.nom AS structure, u.id AS employe_id,
              CONCAT(u.prenom, ' ', u.nom) AS employe, u.matricule,
              ${periodeExpr} AS periode, COUNT(rc.id) AS nombre_jours
       FROM rc
       JOIN utilisateurs u ON rc.utilisateur_id = u.id
       JOIN departements d ON u.departement_id = d.id
       WHERE rc.statut IN ('Disponible', 'Utilisé', 'Expiré', 'Validé Chef', 'En attente')
       GROUP BY d.nom, u.id, employe, u.matricule, periode
       ORDER BY d.nom ASC, employe ASC, periode DESC`
    );

    res.json({ success: true, periode, donnees: rows });
  } catch (error) {
    console.error('Erreur getStatistiquesEmployes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Suppression définitive d'un utilisateur (et de toutes ses données liées)
exports.supprimerUtilisateur = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(`UPDATE utilisateurs SET chef_id = NULL WHERE chef_id = ?`, [id]);
    await pool.query(`DELETE FROM notifications WHERE utilisateur_id = ?`, [id]);
    await pool.query(
      `DELETE drd FROM demande_rc_details drd
       JOIN demandes_conge_rc d ON drd.demande_id = d.id
       WHERE d.utilisateur_id = ?`,
      [id]
    );
    await pool.query(
      `DELETE drd FROM demande_rc_details drd
       JOIN rc ON drd.rc_id = rc.id
       WHERE rc.utilisateur_id = ?`,
      [id]
    );
    await pool.query(`DELETE FROM demandes_conge_rc WHERE utilisateur_id = ? OR valide_par = ?`, [id, id]);
    await pool.query(`DELETE FROM rc WHERE utilisateur_id = ? OR valide_par = ?`, [id, id]);
    await pool.query(`DELETE FROM journal_audit WHERE utilisateur_id = ?`, [id]);
    await pool.query(`DELETE FROM utilisateurs WHERE id = ?`, [id]);

    res.json({ success: true, message: 'Employé supprimé définitivement' });
  } catch (error) {
    console.error('Erreur supprimerUtilisateur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};