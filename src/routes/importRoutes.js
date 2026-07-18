const express = require('express');
const router = express.Router();
const multer = require('multer');
const importController = require('../controllers/importController');
const { verifyToken, checkRole } = require('../middlewares/authMiddleware');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/excel', verifyToken, checkRole([3]), upload.single('fichier'), importController.importerExcel);

module.exports = router;