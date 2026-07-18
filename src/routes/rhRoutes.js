const express = require('express');
const router = express.Router();
const rhController = require('../controllers/rhController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

router.use(verifyToken);

// Accessibles au Chef (scopé à sa structure) ET au RH (tout voir)
router.get('/utilisateurs', checkRole([2, 3]), rhController.getUtilisateurs);
router.get('/rc-par-employe', checkRole([2, 3]), rhController.getRCParEmploye);
router.get('/departements', checkRole([2, 3]), rhController.getDepartements);

// Réservées au RH uniquement
router.post('/utilisateurs', checkRole([3]), rhController.creerUtilisateur);
router.put('/utilisateurs/:id/toggle', checkRole([3]), rhController.toggleActif);
router.put('/utilisateurs/:id', checkRole([3]), rhController.modifierUtilisateur);
router.post('/departements', checkRole([3]), rhController.creerDepartement);
router.get('/statistiques', checkRole([3]), rhController.getStatistiques);
router.get('/statistiques-structure', checkRole([3]), rhController.getStatistiquesStructure);
router.delete('/utilisateurs/:id', checkRole([3]), rhController.supprimerUtilisateur);

module.exports = router;