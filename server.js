require('dotenv').config();
const congeRoutes = require('./src/routes/congeRoutes');
const importRoutes = require('./src/routes/importRoutes');
const rhRoutes = require('./src/routes/rhRoutes');
const express = require('express');
const cors = require('cors');
const pool = require('./src/config/db');
const authRoutes = require('./src/routes/authRoutes');
const { verifyToken } = require('./src/middlewares/authMiddleware');

const app = express();
const rcRoutes = require('./src/routes/rcRoutes');
const startExpirationJob = require('./src/jobs/expirationJob');
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'API Gestion Congés RC - OK' });
});

app.use('/api/auth', authRoutes);

app.get('/api/profil', verifyToken, (req, res) => {
  res.json({ success: true, message: 'Route protégée accessible', utilisateur: req.user });
});

const PORT = process.env.PORT || 5000;
app.use('/api/rc', rcRoutes);
startExpirationJob();
app.use('/api/rh', rhRoutes);
app.use('/api/import', importRoutes);
app.use('/api/conges', congeRoutes);
app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur http://localhost:${PORT}`);
});