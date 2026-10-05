const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', cartController.getCart);
router.post('/add', cartController.addToCart);
router.post('/update/:id', cartController.updateCartItem);
router.post('/remove/:id', cartController.removeCartItem);

module.exports = router;
