const express = require('express');

const { requireAuth } = require('../middleware/auth.middleware');
const bookingsController = require('../controllers/bookings.controller');

const router = express.Router();

router.use(requireAuth);

router.post('/', bookingsController.create);
router.post('/:booking_id/cancel', bookingsController.cancel);

module.exports = router;
