const pool = require('../config/db');

// 1. L'employé déclare un jour travaillé donnant droit à un RC
exports.declarerRC = async (req, res) => {
  try {
    const { date_travail, motif } = req.body;
    const utilisateur_id = req.user.id;

    if (!date_travail) {
      return res.status(400).json({ success: false, message: 'La date travaillée est requise' });
    }

    const [result] = await pool.query(
      `INSERT INTO rc (utilisateur_id, date_travail, motif, date_acquisition, date_expiration, statut)
       VALUES (?, ?, ?, ?, ?, 'En attente')`,
      [utilisateur_id, date_travail, motif || null, date_travail, date_travail]
    );

    res.status(201).json({ success: true, message: 'RC déclaré, en attente de validation', id: result.insertId });
  } catch (error) {
    console.error('Erreur declarerRC:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// 2. Validation à 2 niveaux : Chef (En attente -> Validé Chef) puis RH (Validé Chef -> Disponible)
exports.validerRC = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision } = req.body;
    const valideur_id = req.user.id;
    const role_id = req.user.role_id;

    if (!['valider', 'refuser'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Décision invalide' });
    }

    const [rcRows] = await pool.query('SELECT * FROM rc WHERE id = ?', [id]);
    if (rcRows.length === 0) {
      return res.status(404).json({ success: false, message: 'RC introuvable' });
    }
    const rc = rcRows[0];

    // Refus, possible à n'importe quelle étape
    if (decision === 'refuser') {
      await pool.query(`UPDATE rc SET statut = 'Refusé', valide_par = ? WHERE id = ?`, [valideur_id, id]);
      await pool.query(
        `INSERT INTO notifications (utilisateur_id, rc_id, type_alerte, message) VALUES (?, ?, 'Refus', ?)`,
        [rc.utilisateur_id, id, `Votre demande de RC du ${rc.date_travail} a été refusée.`]
      );
      return res.json({ success: true, message: 'RC refusé' });
    }

    // Validation niveau 1 : le Chef valide un RC "En attente"
    if (role_id === 2 && rc.statut === 'En attente') {
      await pool.query(`UPDATE rc SET statut = 'Validé Chef', valide_par = ? WHERE id = ?`, [valideur_id, id]);

      const [rhUsers] = await pool.query(`SELECT id FROM utilisateurs WHERE role_id = 3 AND actif = 1`);
      for (const rh of rhUsers) {
        await pool.query(
          `INSERT INTO notifications (utilisateur_id, rc_id, type_alerte, message) VALUES (?, ?, 'Validation RH', ?)`,
          [rh.id, id, `Un RC a été validé par le chef et attend votre validation finale.`]
        );
      }

      return res.json({ success: true, message: 'RC validé par le chef, en attente de validation RH' });
    }

    // Validation niveau 2 : le RH fait la validation finale
    if (role_id === 3 && rc.statut === 'Validé Chef') {
      await pool.query(
        `UPDATE rc 
         SET statut = 'Disponible', valide_par = ?, 
             date_acquisition = CURDATE(), 
             date_expiration = DATE_ADD(CURDATE(), INTERVAL 3 MONTH)
         WHERE id = ?`,
        [valideur_id, id]
      );

      await pool.query(
        `INSERT INTO notifications (utilisateur_id, rc_id, type_alerte, message) VALUES (?, ?, 'Validation RH', ?)`,
        [rc.utilisateur_id, id, `Votre RC du ${rc.date_travail} a été définitivement validé.`]
      );

      return res.json({ success: true, message: 'RC validé définitivement' });
    }

    return res.status(403).json({ success: false, message: 'Vous ne pouvez pas valider ce RC à cette étape' });
  } catch (error) {
    console.error('Erreur validerRC:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// 3. Solde disponible d'un employé
exports.getSolde = async (req, res) => {
  try {
    const utilisateur_id = req.params.userId || req.user.id;
    const [rows] = await pool.query(
      `SELECT id, date_travail, motif, date_acquisition, date_expiration, statut
       FROM rc WHERE utilisateur_id = ? AND statut = 'Disponible' ORDER BY date_expiration ASC`,
      [utilisateur_id]
    );
    res.json({ success: true, solde: rows.length, rc: rows });
  } catch (error) {
    console.error('Erreur getSolde:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// 4. Historique complet
exports.getHistorique = async (req, res) => {
  try {
    const utilisateur_id = req.params.userId || req.user.id;
    const [rows] = await pool.query(
      `SELECT * FROM rc WHERE utilisateur_id = ? ORDER BY date_acquisition DESC`,
      [utilisateur_id]
    );
    res.json({ success: true, historique: rows });
  } catch (error) {
    console.error('Erreur getHistorique:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// 5. Liste des RC à valider, scopée selon le rôle
exports.getRCEnAttente = async (req, res) => {
  try {
    const role_id = req.user.role_id;
    let query, params;

    if (role_id === 2) {
      query = `SELECT rc.*, u.nom, u.prenom, u.email, d.nom AS departement
               FROM rc rc
               JOIN utilisateurs u ON rc.utilisateur_id = u.id
               JOIN departements d ON u.departement_id = d.id
               WHERE rc.statut = 'En attente'
                 AND u.departement_id = (SELECT departement_id FROM utilisateurs WHERE id = ?)
               ORDER BY rc.date_travail ASC`;
      params = [req.user.id];
    } else {
      query = `SELECT rc.*, u.nom, u.prenom, u.email, d.nom AS departement
               FROM rc rc
               JOIN utilisateurs u ON rc.utilisateur_id = u.id
               JOIN departements d ON u.departement_id = d.id
               WHERE rc.statut = 'Validé Chef'
               ORDER BY rc.date_travail ASC`;
      params = [];
    }

    const [rows] = await pool.query(query, params);
    res.json({ success: true, rc_en_attente: rows });
  } catch (error) {
    console.error('Erreur getRCEnAttente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// 6. Expiration automatique (job quotidien)
exports.expirerRC = async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE rc SET statut = 'Expiré' WHERE statut = 'Disponible' AND date_expiration < CURDATE()`
    );
    res.json({ success: true, message: `${result.affectedRows} RC expiré(s)` });
  } catch (error) {
    console.error('Erreur expirerRC:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// 7. Notifications de l'utilisateur connecté
exports.getNotifications = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM notifications WHERE utilisateur_id = ? ORDER BY created_at DESC LIMIT 30`,
      [req.user.id]
    );
    res.json({ success: true, notifications: rows });
  } catch (error) {
    console.error('Erreur getNotifications:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// 8. Marquer une notification comme lue
exports.marquerNotificationLue = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE notifications SET lue = 1 WHERE id = ? AND utilisateur_id = ?`, [id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur marquerNotificationLue:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};