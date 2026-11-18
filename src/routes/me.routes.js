const express = require('express');

const { requireAuth } = require('../middleware/auth.middleware');
const meController = require('../controllers/me.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/booking', meController.getBooking);

module.exports = router;
