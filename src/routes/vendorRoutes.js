const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const { requireAuth, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Enforce vendor authorization on all vendor routes
router.use(requireAuth, requireRole('vendor', 'admin'));

router.get('/', vendorController.getDashboard);
router.get('/products/new', vendorController.renderNewProduct);
router.post('/products/new', upload.single('image'), vendorController.createProduct);
router.get('/products/:id/edit', vendorController.renderEditProduct);
router.post('/products/:id/edit', upload.single('image'), vendorController.updateProduct);
router.post('/products/:id/delete', vendorController.deleteProduct);
router.get('/orders', vendorController.getVendorOrders);

module.exports = router;
