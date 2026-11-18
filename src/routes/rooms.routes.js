const express = require('express');

const { requireAuth } = require('../middleware/auth.middleware');
const roomsController = require('../controllers/rooms.controller');

const router = express.Router();

router.use(requireAuth);

router.get('/', roomsController.list);

module.exports = router;
