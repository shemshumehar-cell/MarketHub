const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { requireAuth } = require('../middleware/auth');
const { orderLimiter } = require('../middleware/security');

router.use(requireAuth);

router.get('/', orderController.listOrders);
router.get('/checkout', orderController.renderCheckout);
router.post('/checkout', orderLimiter, orderController.processCheckout);
router.get('/:id', orderController.getOrderDetails);

module.exports = router;
