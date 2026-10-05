const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authLimiter } = require('../middleware/security');

router.get('/login', authController.renderLogin);
router.post('/login', authLimiter, authController.handleLogin);

router.get('/register', authController.renderRegister);
router.post('/register', authLimiter, authController.handleRegister);

router.get('/logout', authController.handleLogout);
router.post('/logout', authController.handleLogout);

module.exports = router;
