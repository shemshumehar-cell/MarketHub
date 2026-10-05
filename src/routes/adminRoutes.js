const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middleware/auth');

// Strict Admin RBAC gate: only administrators can reach these routes
router.use(requireAuth, requireRole('admin'));

router.get('/', adminController.getDashboard);
router.get('/users', adminController.listUsers);
router.post('/users/:id/status', adminController.toggleUserStatus);
router.post('/users/:id/role', adminController.changeUserRole);

router.get('/products', adminController.listProducts);
router.post('/products/:id/status', adminController.toggleProductStatus);

router.get('/orders', adminController.listOrders);
router.post('/orders/:id/status', adminController.updateOrderStatus);

router.get('/logs', adminController.listAuditLogs);

module.exports = router;
