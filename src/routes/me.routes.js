const express = require('express');

const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(requireAuth);

// Placeholder: always reports no booking until the booking steps are written.
router.get('/booking', (req, res) => {
  res.json({ booking: null });
});

module.exports = router;
