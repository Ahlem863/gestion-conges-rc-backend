const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

exports.importerExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const lignes = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    let crees = 0;
    let rcCreés = 0;
    let ignorés = 0;
    const erreurs = [];
    const identifiants = [];

    // Fonction pour retirer les accents (é -> e, etc.)
    const normaliser = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    for (const ligne of lignes) {
      const matricule = String(ligne[0] || '').trim();
      const nomComplet = String(ligne[1] || '').trim();
      const structure = String(ligne[2] || '').trim();
      const solde = parseInt(ligne[5], 10) || 0;

      if (!matricule || !nomComplet || !structure) {
        ignorés++;
        continue;
      }

      try {
        // 1. Trouver ou créer la structure (département)
        let [deptRows] = await pool.query('SELECT id FROM departements WHERE nom = ?', [structure]);
        let departement_id;
        if (deptRows.length === 0) {
          const [insertDept] = await pool.query('INSERT INTO departements (nom) VALUES (?)', [structure]);
          departement_id = insertDept.insertId;
        } else {
          departement_id = deptRows[0].id;
        }

        // 2. Trouver ou créer l'employé
        let [userRows] = await pool.query('SELECT id FROM utilisateurs WHERE matricule = ?', [matricule]);
        let utilisateur_id;

        if (userRows.length === 0) {
          const parts = nomComplet.split(' ');
          const prenom = parts[0];
          const nom = parts.slice(1).join(' ') || parts[0];

          const emailGenere = `${normaliser(prenom)}.${normaliser(nom)}@tunisietelecom.tn`;

          const prefixeStructure = normaliser(structure.split(/[\s/]/)[0]).substring(0, 3);
          const motDePasseGenere = `${prefixeStructure}123456`;

          const hash = await bcrypt.hash(motDePasseGenere, 10);

          const [insertUser] = await pool.query(
            `INSERT INTO utilisateurs (matricule, nom, prenom, email, mot_de_passe, role_id, departement_id)
             VALUES (?, ?, ?, ?, ?, 1, ?)`,
            [matricule, nom, prenom, emailGenere, hash, departement_id]
          );
          utilisateur_id = insertUser.insertId;
          crees++;

          identifiants.push({ matricule, nom: nomComplet, email: emailGenere, mot_de_passe: motDePasseGenere });
        } else {
          utilisateur_id = userRows[0].id;
        }

        // 3. Créer les RC "Disponible" correspondant au solde
        for (let i = 0; i < solde; i++) {
          await pool.query(
            `INSERT INTO rc (utilisateur_id, date_travail, motif, date_acquisition, date_expiration, statut)
             VALUES (?, CURDATE(), 'Import initial', CURDATE(), DATE_ADD(CURDATE(), INTERVAL 3 MONTH), 'Disponible')`,
            [utilisateur_id]
          );
          rcCreés++;
        }
      } catch (err) {
        erreurs.push(`${matricule}: ${err.message}`);
      }
    }

    res.json({
      success: true,
      message: `Import terminé : ${crees} employé(s) créé(s), ${rcCreés} RC créés, ${ignorés} ligne(s) ignorée(s)`,
      erreurs,
      identifiants,
    });
  } catch (error) {
    console.error('Erreur importerExcel:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};