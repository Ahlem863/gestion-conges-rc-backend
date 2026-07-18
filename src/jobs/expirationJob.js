const cron = require('node-cron');
const pool = require('../config/db');

function startExpirationJob() {
  // Tous les jours à 00h05
  cron.schedule('5 0 * * *', async () => {
    try {
      const [result] = await pool.query(
        `UPDATE rc SET statut = 'Expiré' WHERE statut = 'Disponible' AND date_expiration < CURDATE()`
      );
      console.log(`🕐 Job expiration: ${result.affectedRows} RC expiré(s)`);
    } catch (error) {
      console.error('Erreur job expiration:', error.message);
    }
  });

  console.log('✅ Job d\'expiration automatique planifié (tous les jours à 00h05)');
}

module.exports = startExpirationJob;