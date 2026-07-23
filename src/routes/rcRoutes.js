const express = require('express');
const router = express.Router();
const rcController = require('../controllers/rcController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

router.use(verifyToken);

router.post('/declarer-pour-employe', checkRole([2]), rcController.declarerRCPourEmploye);
router.get('/employes-structure', checkRole([2]), rcController.getEmployesDeStructure);
router.put('/:id/modifier', checkRole([3]), rcController.modifierRC);
router.delete('/:id', checkRole([3]), rcController.supprimerRC);
router.put('/:id/valider', checkRole([2, 3]), rcController.validerRC);
router.get('/solde', rcController.getSolde);
router.get('/solde/:userId', checkRole([2, 3]), rcController.getSolde);
router.get('/historique', rcController.getHistorique);
router.get('/historique/:userId', checkRole([2, 3]), rcController.getHistorique);
router.get('/en-attente', checkRole([2, 3]), rcController.getRCEnAttente);
router.post('/expirer', checkRole([3]), rcController.expirerRC);

router.get('/notifications', rcController.getNotifications);
router.put('/notifications/:id/lue', rcController.marquerNotificationLue);

module.exports = router;