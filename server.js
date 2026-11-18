require('dotenv').config({ quiet: true });

const app = require('./src/app');
const { checkConnection } = require('./src/config/db');

const PORT = process.env.PORT || 3000;

async function start() {
  // Never sign tokens with an empty secret.
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set. Copy .env.example to .env and set it.');
    process.exit(1);
  }

  try {
    await checkConnection();
    console.log('Database connected');
  } catch (err) {
    console.error(`Cannot connect to the database: ${err.message}`);
    console.error('Is PostgreSQL running? Try: docker compose up -d');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

start();
