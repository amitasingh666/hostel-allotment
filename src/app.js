const express = require('express');

const { checkConnection } = require('./config/db');
const authRoutes = require('./routes/auth.routes');
const meRoutes = require('./routes/me.routes');
const roomsRoutes = require('./routes/rooms.routes');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');

const app = express();

app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await checkConnection();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'down' });
  }
});

app.use('/auth', authRoutes);
app.use('/me', meRoutes);
app.use('/rooms', roomsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
