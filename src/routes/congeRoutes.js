const express = require('express');
const router = express.Router();
const congeController = require('../controllers/congeController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

router.use(verifyToken);

router.post('/demander', checkRole([1]), congeController.demanderConge);
router.put('/:id/valider', checkRole([2]), congeController.validerConge);
router.get('/en-attente', checkRole([2]), congeController.getCongesEnAttente);
router.get('/mes-conges', congeController.getMesConges);
router.get('/mes-conges/:userId', checkRole([2, 3]), congeController.getMesConges);
router.get('/toutes', checkRole([3]), congeController.getToutesLesDemandes);

module.exports = router;