const authService = require('../services/auth.service');

async function login(req, res) {
  const { registration_no: registrationNo, password } = req.body || {};
  const token = await authService.login(registrationNo, password);
  res.json({ token });
}

module.exports = { login };
