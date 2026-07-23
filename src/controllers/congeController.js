const pool = require('../config/db');

// Calcule le nombre de jours entre 2 dates, en excluant les dimanches,
// et en ajoutant +1 jour (samedi) pour chaque vendredi compris dans la période
function calculerJours(dateDebut, dateFin) {
  const debut = new Date(dateDebut);
  const fin = new Date(dateFin);
  let total = 0;
  let vendredisComptes = 0;

  const courant = new Date(debut);
  while (courant <= fin) {
    const jourSemaine = courant.getDay(); // 0=dimanche, 5=vendredi, 6=samedi
    if (jourSemaine !== 0) {
      total++;
    }
    if (jourSemaine === 5) {
      vendredisComptes++;
    }
    courant.setDate(courant.getDate() + 1);
  }

  return total + vendredisComptes;
}

// L'employé demande un congé RC
exports.demanderConge = async (req, res) => {
  try {
    const { date_debut, date_fin, commentaire } = req.body;
    const utilisateur_id = req.user.id;

    if (!date_debut || !date_fin) {
      return res.status(400).json({ success: false, message: 'Dates requises' });
    }
    if (new Date(date_fin) < new Date(date_debut)) {
      return res.status(400).json({ success: false, message: 'La date de fin doit être après la date de début' });
    }

    const nombreJours = calculerJours(date_debut, date_fin);

    // Vérifier le solde disponible
    const [soldeRows] = await pool.query(
      `SELECT COUNT(*) AS solde FROM rc WHERE utilisateur_id = ? AND statut = 'Disponible'`,
      [utilisateur_id]
    );
    if (soldeRows[0].solde < nombreJours) {
      return res.status(400).json({
        success: false,
        message: `Solde insuffisant : ${nombreJours} jour(s) demandé(s), ${soldeRows[0].solde} disponible(s)`
      });
    }

    // Créer la demande
    const [result] = await pool.query(
      `INSERT INTO demandes_conge_rc (utilisateur_id, date_debut, date_fin, nombre_jours, statut, commentaire)
       VALUES (?, ?, ?, ?, 'En attente', ?)`,
      [utilisateur_id, date_debut, date_fin, nombreJours, commentaire || null]
    );

    // Notifier le chef de la structure de l'employé
    const [empRows] = await pool.query('SELECT departement_id, nom, prenom FROM utilisateurs WHERE id = ?', [utilisateur_id]);
    const [chefs] = await pool.query(
      `SELECT id FROM utilisateurs WHERE role_id = 2 AND departement_id = ? AND actif = 1`,
      [empRows[0].departement_id]
    );
    for (const chef of chefs) {
      await pool.query(
        `INSERT INTO notifications (utilisateur_id, type_alerte, message) VALUES (?, 'Validation Chef', ?)`,
        [chef.id, `${empRows[0].prenom} ${empRows[0].nom} demande un congé RC du ${date_debut} au ${date_fin} (${nombreJours} jour(s)).`]
      );
    }

    res.status(201).json({ success: true, message: `Demande envoyée (${nombreJours} jour(s))`, id: result.insertId, nombre_jours: nombreJours });
  } catch (error) {
    console.error('Erreur demanderConge:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Le Chef valide ou refuse une demande de congé
exports.validerConge = async (req, res) => {
  try {
    const { id } = req.params;
    const { decision } = req.body;
    const chef_id = req.user.id;

    if (!['valider', 'refuser'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Décision invalide' });
    }

    const [demandeRows] = await pool.query('SELECT * FROM demandes_conge_rc WHERE id = ?', [id]);
    if (demandeRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Demande introuvable' });
    }
    const demande = demandeRows[0];

    if (decision === 'refuser') {
      await pool.query(`UPDATE demandes_conge_rc SET statut = 'Refusée', valide_par = ? WHERE id = ?`, [chef_id, id]);
      await pool.query(
        `INSERT INTO notifications (utilisateur_id, type_alerte, message) VALUES (?, 'Refus', ?)`,
        [demande.utilisateur_id, `Votre demande de congé RC du ${demande.date_debut} au ${demande.date_fin} a été refusée.`]
      );
      return res.json({ success: true, message: 'Demande refusée' });
    }

    // Validation : marquer N RC "Disponible" (les plus anciens en expiration) comme "Utilisé"
    const [rcDisponibles] = await pool.query(
      `SELECT id FROM rc WHERE utilisateur_id = ? AND statut = 'Disponible' ORDER BY date_expiration ASC LIMIT ?`,
      [demande.utilisateur_id, demande.nombre_jours]
    );

    if (rcDisponibles.length < demande.nombre_jours) {
      return res.status(400).json({ success: false, message: 'Solde insuffisant au moment de la validation' });
    }

    for (const rc of rcDisponibles) {
      await pool.query(`UPDATE rc SET statut = 'Utilisé' WHERE id = ?`, [rc.id]);
      await pool.query(
        `INSERT INTO demande_rc_details (demande_id, rc_id) VALUES (?, ?)`,
        [id, rc.id]
      );
    }

    await pool.query(`UPDATE demandes_conge_rc SET statut = 'Validée', valide_par = ? WHERE id = ?`, [chef_id, id]);

    // Notifier l'employé
    await pool.query(
      `INSERT INTO notifications (utilisateur_id, type_alerte, message) VALUES (?, 'Validation Chef', ?)`,
      [demande.utilisateur_id, `Votre congé RC du ${demande.date_debut} au ${demande.date_fin} a été validé.`]
    );

    // Informer le RH (simple information, pas d'action requise)
    const [rhUsers] = await pool.query(`SELECT id FROM utilisateurs WHERE role_id = 3 AND actif = 1`);
    const [empRows] = await pool.query('SELECT nom, prenom FROM utilisateurs WHERE id = ?', [demande.utilisateur_id]);
    for (const rh of rhUsers) {
      await pool.query(
        `INSERT INTO notifications (utilisateur_id, type_alerte, message) VALUES (?, 'Validation Chef', ?)`,
        [rh.id, `${empRows[0].prenom} ${empRows[0].nom} a pris ${demande.nombre_jours} jour(s) de congé RC du ${demande.date_debut} au ${demande.date_fin}.`]
      );
    }

    res.json({ success: true, message: 'Congé validé, solde décrémenté' });
  } catch (error) {
    console.error('Erreur validerConge:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Liste des demandes de congé en attente pour le chef de structure
exports.getCongesEnAttente = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.*, u.nom, u.prenom, u.matricule
       FROM demandes_conge_rc d
       JOIN utilisateurs u ON d.utilisateur_id = u.id
       WHERE d.statut = 'En attente'
         AND u.departement_id = (SELECT departement_id FROM utilisateurs WHERE id = ?)
       ORDER BY d.created_at ASC`,
      [req.user.id]
    );
    res.json({ success: true, conges: rows });
  } catch (error) {
    console.error('Erreur getCongesEnAttente:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Historique des demandes de congé de l'employé connecté (ou d'un employé donné pour Chef/RH)
exports.getMesConges = async (req, res) => {
  try {
    const utilisateur_id = req.params.userId || req.user.id;
    const [rows] = await pool.query(
      `SELECT * FROM demandes_conge_rc WHERE utilisateur_id = ? ORDER BY created_at DESC`,
      [utilisateur_id]
    );
    res.json({ success: true, conges: rows });
  } catch (error) {
    console.error('Erreur getMesConges:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Toutes les demandes de congé (pour information du RH)
exports.getToutesLesDemandes = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.*, u.nom, u.prenom, u.matricule, dep.nom AS structure
       FROM demandes_conge_rc d
       JOIN utilisateurs u ON d.utilisateur_id = u.id
       JOIN departements dep ON u.departement_id = dep.id
       ORDER BY d.created_at DESC
       LIMIT 100`
    );
    res.json({ success: true, conges: rows });
  } catch (error) {
    console.error('Erreur getToutesLesDemandes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};