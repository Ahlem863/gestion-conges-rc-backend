const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

// ============================================================
// Fonctions utilitaires de dates (pour le format historique)
// ============================================================

// Ajoute un nombre de mois à une date, en gérant correctement les fins de mois
function ajouterMois(date, mois) {
  const d = new Date(date);
  const jourOrigine = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + mois);
  const dernierJourMoisCible = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(jourOrigine, dernierJourMoisCible));
  return d;
}

function formatDateSQL(date) {
  return date.toISOString().substring(0, 10);
}

// Retourne la liste des dimanches d'un mois donné (année, mois 1-12)
function dimanchesDuMois(annee, mois) {
  const resultats = [];
  const d = new Date(annee, mois - 1, 1);
  while (d.getDay() !== 0) {
    d.setDate(d.getDate() + 1);
  }
  while (d.getMonth() === mois - 1) {
    resultats.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return resultats;
}

// Retourne la liste des dimanches compris entre deux dates (incluses)
function dimanchesDansFenetre(debut, fin) {
  const resultats = [];
  const d = new Date(debut);
  while (d.getDay() !== 0) {
    d.setDate(d.getDate() + 1);
  }
  while (d <= fin) {
    resultats.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return resultats;
}

// Retourne n dates en cyclant sur le pool fourni (si n > pool.length, on reboucle)
// depuis le DÉBUT (dates les plus anciennes en premier).
function cyclerSur(pool, n) {
  if (pool.length === 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(pool[i % pool.length]);
  }
  return out;
}

// Retourne n dates en cyclant sur le pool fourni depuis la FIN (dates les plus
// récentes en premier). Utilisé pour les RC "Disponible" restants, afin qu'ils
// soient toujours datés plus récemment que les RC déjà "Utilisé" — cohérent avec
// la règle métier : on consomme toujours les RC les plus proches de l'expiration
// (donc les plus anciens) en premier.
function cyclerSurDepuisLaFin(pool, n) {
  if (pool.length === 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(pool[pool.length - 1 - (i % pool.length)]);
  }
  return out;
}

const MOIS_MAP = {
  'janvier': 1, 'fevrier': 2, 'février': 2, 'mars': 3, 'avril': 4, 'mai': 5,
  'juin': 6, 'juillet': 7, 'aout': 8, 'août': 8, 'septembre': 9,
  'octobre': 10, 'novembre': 11, 'decembre': 12, 'décembre': 12,
};

function normaliserTexte(str) {
  return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// ============================================================
// Détection du format du fichier Excel
// ============================================================
// Format "simple" (existant) : Matricule | Nom complet | Structure | ... | Solde
// Format "historique"        : Mois | Nom complet | Matricule | RC solde début | Congés récupérés | Congés conso | Solde final
function estFormatHistorique(headerRow) {
  const texteHeader = headerRow.map((c) => normaliserTexte(c)).join(' | ');
  return texteHeader.includes('solde debut') || texteHeader.includes('conges recuperes') || texteHeader.includes('conges recupere');
}

// ============================================================
// IMPORT — FORMAT SIMPLE (comportement existant, inchangé)
// ============================================================
async function traiterFormatSimple(lignes, res) {
  let crees = 0;
  let rcCreés = 0;
  let ignorés = 0;
  const erreurs = [];
  const identifiants = [];

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
      let [deptRows] = await pool.query('SELECT id FROM departements WHERE nom = ?', [structure]);
      let departement_id;
      if (deptRows.length === 0) {
        const [insertDept] = await pool.query('INSERT INTO departements (nom) VALUES (?)', [structure]);
        departement_id = insertDept.insertId;
      } else {
        departement_id = deptRows[0].id;
      }

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

  return res.json({
    success: true,
    format: 'simple',
    message: `Import terminé : ${crees} employé(s) créé(s), ${rcCreés} RC créés, ${ignorés} ligne(s) ignorée(s)`,
    erreurs,
    identifiants,
  });
}

// ============================================================
// IMPORT — FORMAT HISTORIQUE (nouveau : suivi mois par mois)
// ============================================================
// Colonnes attendues : Mois | Nom complet | Matricule | RC solde début | Congés récupérés | Congés conso | Solde final
async function traiterFormatHistorique(lignes, res) {
  const AUJOURDHUI = new Date();
  AUJOURDHUI.setHours(0, 0, 0, 0);
  const FENETRE_DEBUT = ajouterMois(AUJOURDHUI, -3); // date d'acquisition minimale pour rester "Disponible"
  const ANNEE_REFERENCE = AUJOURDHUI.getFullYear();
  const poolFenetreSure = dimanchesDansFenetre(FENETRE_DEBUT, AUJOURDHUI);

  // Regrouper les lignes par matricule, en conservant l'ordre chronologique des mois
  const parEmploye = new Map();
  for (const ligne of lignes) {
    const moisTexte = normaliserTexte(ligne[0]);
    const nomComplet = String(ligne[1] || '').trim();
    const matricule = String(ligne[2] || '').trim();
    const soldeDebut = parseInt(ligne[3], 10) || 0;
    const recup = parseInt(ligne[4], 10) || 0;
    const conso = parseInt(ligne[5], 10) || 0;
    const soldeFinal = ligne[6] !== '' && ligne[6] !== undefined ? parseInt(ligne[6], 10) : null;

    if (!matricule || !moisTexte || !MOIS_MAP[moisTexte]) continue;

    if (!parEmploye.has(matricule)) {
      parEmploye.set(matricule, { nomComplet, lignes: [] });
    }
    parEmploye.get(matricule).lignes.push({
      mois: MOIS_MAP[moisTexte], soldeDebut, recup, conso, soldeFinal,
    });
  }

  let employesTraites = 0;
  let rcCreés = 0;
  const erreurs = [];
  const avertissements = [];

  for (const [matricule, data] of parEmploye) {
    try {
      const [userRows] = await pool.query('SELECT id FROM utilisateurs WHERE matricule = ?', [matricule]);
      if (userRows.length === 0) {
        erreurs.push(`${matricule} (${data.nomComplet}) : employé introuvable — création impossible sans structure dans ce format. Créez-le d'abord manuellement ou via le format simple.`);
        continue;
      }
      const utilisateur_id = userRows[0].id;

      const lignesTri = data.lignes; // déjà dans l'ordre du fichier
      const baseline = lignesTri[0].soldeDebut;
      const totalRecup = lignesTri.reduce((s, l) => s + l.recup, 0);
      const totalConso = lignesTri.reduce((s, l) => s + l.conso, 0);
      const derniereLigne = lignesTri[lignesTri.length - 1];
      const soldeFinalCible = derniereLigne.soldeFinal !== null ? derniereLigne.soldeFinal : (baseline + totalRecup - totalConso);

      // Contrôle de cohérence
      const soldeCalcule = baseline + totalRecup - totalConso;
      if (soldeCalcule !== soldeFinalCible) {
        avertissements.push(
          `${matricule} (${data.nomComplet}) : incohérence détectée — calcul = ${soldeCalcule}, solde final indiqué = ${soldeFinalCible}. ` +
          `Import effectué en utilisant ${soldeFinalCible} comme cible (colonne "Solde final").`
        );
      }

      // RC consommés : datés sur les vrais dimanches du mois où le congé a été pris.
      // Pour chaque mois avec conso > 0, on crée AUSSI une demande de congé "Validée"
      // (période de `conso` jours consécutifs, démarrant au 1er du mois) et on relie
      // les RC consommés à cette demande, afin que « Congés (info) » affiche l'historique.
      for (const l of lignesTri) {
        if (l.conso > 0) {
          const poolMois = dimanchesDuMois(ANNEE_REFERENCE, l.mois);
          const dates = cyclerSur(poolMois, l.conso);

          const rcIdsDuMois = [];
          for (const d of dates) {
            const [insertRc] = await pool.query(
              `INSERT INTO rc (utilisateur_id, date_travail, motif, date_acquisition, date_expiration, statut)
               VALUES (?, ?, 'Travail jour férié ou exceptionnel', ?, ?, 'Utilisé')`,
              [utilisateur_id, formatDateSQL(d), formatDateSQL(d), formatDateSQL(ajouterMois(d, 3))]
            );
            rcIdsDuMois.push(insertRc.insertId);
            rcCreés++;
          }

          // Période de congé reconstituée : `conso` jours consécutifs à partir du 1er du mois
          const dateDebut = new Date(ANNEE_REFERENCE, l.mois - 1, 1);
          const dateFin = new Date(dateDebut);
          dateFin.setDate(dateFin.getDate() + l.conso - 1);

          const [insertDemande] = await pool.query(
            `INSERT INTO demandes_conge_rc (utilisateur_id, date_debut, date_fin, nombre_jours, statut, valide_par, commentaire)
             VALUES (?, ?, ?, ?, 'Validée', NULL, 'Import historique')`,
            [utilisateur_id, formatDateSQL(dateDebut), formatDateSQL(dateFin), l.conso]
          );
          const demande_id = insertDemande.insertId;

          for (const rc_id of rcIdsDuMois) {
            await pool.query(
              `INSERT INTO demande_rc_details (demande_id, rc_id) VALUES (?, ?)`,
              [demande_id, rc_id]
            );
          }
        }
      }

      // RC restant disponibles : datés dans la fenêtre sûre (aujourd'hui - 3 mois -> aujourd'hui),
      // en privilégiant les dates les plus RÉCENTES du pool (cyclerSurDepuisLaFin), pour que ces RC
      // restent toujours plus récents que ceux déjà marqués "Utilisé" (cohérence FIFO).
      const datesDispo = cyclerSurDepuisLaFin(poolFenetreSure, Math.max(soldeFinalCible, 0));
      for (const d of datesDispo) {
        await pool.query(
          `INSERT INTO rc (utilisateur_id, date_travail, motif, date_acquisition, date_expiration, statut)
           VALUES (?, ?, 'Travail jour férié ou exceptionnel', ?, ?, 'Disponible')`,
          [utilisateur_id, formatDateSQL(d), formatDateSQL(d), formatDateSQL(ajouterMois(d, 3))]
        );
        rcCreés++;
      }

      employesTraites++;
    } catch (err) {
      erreurs.push(`${matricule} (${data.nomComplet}) : ${err.message}`);
    }
  }

  return res.json({
    success: true,
    format: 'historique',
    message: `Import historique terminé : ${employesTraites} employé(s) traité(s), ${rcCreés} RC créés au total.`,
    erreurs,
    avertissements,
  });
}

// ============================================================
// POINT D'ENTRÉE UNIQUE
// ============================================================
exports.importerExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const toutesLesLignes = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (toutesLesLignes.length === 0) {
      return res.status(400).json({ success: false, message: 'Fichier vide' });
    }

    const headerRow = toutesLesLignes[0];
    const lignesDeDonnees = toutesLesLignes.slice(1); // on retire la ligne d'en-tête

    if (estFormatHistorique(headerRow)) {
      return await traiterFormatHistorique(lignesDeDonnees, res);
    } else {
      return await traiterFormatSimple(lignesDeDonnees, res);
    }
  } catch (error) {
    console.error('Erreur importerExcel:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};