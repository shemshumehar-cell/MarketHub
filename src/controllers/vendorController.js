const { db, logAudit } = require('../config/database');
const { sanitizeInput } = require('../middleware/security');

function getDashboard(req, res) {
  try {
    const vendorId = req.session.user.id;

    // Fetch vendor's products
    const products = db.prepare(`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.vendor_id = ?
      ORDER BY p.created_at DESC
    `).all(vendorId);

    // Vendor sales analytics (only for items sold by THIS vendor)
    const salesMetrics = db.prepare(`
      SELECT 
        COUNT(oi.id) AS total_units_sold,
        COALESCE(SUM(oi.unit_price * oi.quantity), 0) AS total_revenue
      FROM order_items oi
      WHERE oi.vendor_id = ?
    `).get(vendorId);

    // Low stock warnings (< 5 units)
    const lowStockItems = products.filter(p => p.stock < 5);

    res.render('vendor/dashboard', {
      title: 'Vendor Dashboard — MarketHub',
      products,
      metrics: {
        totalProducts: products.length,
        totalUnitsSold: salesMetrics.total_units_sold || 0,
        totalRevenue: Number(salesMetrics.total_revenue || 0).toFixed(2),
        lowStockCount: lowStockItems.length
      },
      lowStockItems,
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    console.error('Error loading vendor dashboard:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Failed to load vendor dashboard.'
    });
  }
}

function renderNewProduct(req, res) {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
  res.render('vendor/product-form', {
    title: 'Add New Product — MarketHub',
    product: null,
    categories,
    isEdit: false,
    error: req.query.error || null
  });
}

function createProduct(req, res) {
  try {
    const vendorId = req.session.user.id;
    const title = sanitizeInput(req.body.title);
    const description = sanitizeInput(req.body.description);
    const price = parseFloat(req.body.price);
    const stock = parseInt(req.body.stock, 10);
    const categoryId = parseInt(req.body.category_id, 10) || null;

    if (!title || title.length < 3) {
      return res.redirect('/vendor/products/new?error=Product title must be at least 3 characters.');
    }

    if (isNaN(price) || price < 0) {
      return res.redirect('/vendor/products/new?error=Invalid price specified.');
    }

    if (isNaN(stock) || stock < 0) {
      return res.redirect('/vendor/products/new?error=Invalid stock count.');
    }

    let imageUrl = '/images/placeholder.svg';
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const insert = db.prepare(`
      INSERT INTO products (vendor_id, category_id, title, description, price, stock, image_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `);
    const result = insert.run(vendorId, categoryId, title, description, price, stock, imageUrl);
    const newProductId = Number(result.lastInsertRowid);

    logAudit(vendorId, 'PRODUCT_CREATED', `Vendor added product #${newProductId}: "${title}" ($${price})`, req.ip);

    res.redirect('/vendor?success=Product published successfully.');
  } catch (err) {
    console.error('Error creating product:', err);
    res.redirect('/vendor/products/new?error=Failed to publish product.');
  }
}

function renderEditProduct(req, res) {
  try {
    const vendorId = req.session.user.id;
    const productId = parseInt(req.params.id, 10);

    // IDOR Check: Ensure the product belongs to this vendor
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND vendor_id = ?').get(productId, vendorId);

    if (!product) {
      logAudit(vendorId, 'UNAUTHORIZED_PRODUCT_EDIT_ATTEMPT', `Vendor attempted to edit product #${productId} not owned by them`, req.ip);
      return res.status(403).render('errors/403', {
        title: '403 Forbidden',
        message: 'Security Alert: You can only edit products belonging to your vendor store.'
      });
    }

    const categories = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();

    res.render('vendor/product-form', {
      title: `Edit "${product.title}" — MarketHub`,
      product,
      categories,
      isEdit: true,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Error loading edit form:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Failed to load product.'
    });
  }
}

function updateProduct(req, res) {
  try {
    const vendorId = req.session.user.id;
    const productId = parseInt(req.params.id, 10);

    // IDOR Check: Server-side ownership confirmation
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND vendor_id = ?').get(productId, vendorId);
    if (!product) {
      logAudit(vendorId, 'UNAUTHORIZED_PRODUCT_UPDATE_ATTEMPT', `Vendor attempted to update product #${productId} not owned by them`, req.ip);
      return res.status(403).render('errors/403', {
        title: '403 Forbidden',
        message: 'Security Alert: You can only modify your own products.'
      });
    }

    const title = sanitizeInput(req.body.title);
    const description = sanitizeInput(req.body.description);
    const price = parseFloat(req.body.price);
    const stock = parseInt(req.body.stock, 10);
    const categoryId = parseInt(req.body.category_id, 10) || null;
    const status = ['active', 'inactive'].includes(req.body.status) ? req.body.status : product.status;

    let imageUrl = product.image_url;
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const update = db.prepare(`
      UPDATE products 
      SET category_id = ?, title = ?, description = ?, price = ?, stock = ?, image_url = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND vendor_id = ?
    `);
    update.run(categoryId, title, description, price, stock, imageUrl, status, productId, vendorId);

    logAudit(vendorId, 'PRODUCT_UPDATED', `Vendor updated product #${productId}: "${title}"`, req.ip);

    res.redirect('/vendor?success=Product updated successfully.');
  } catch (err) {
    console.error('Error updating product:', err);
    res.redirect(`/vendor/products/${req.params.id}/edit?error=Failed to update product.`);
  }
}

function deleteProduct(req, res) {
  try {
    const vendorId = req.session.user.id;
    const productId = parseInt(req.params.id, 10);

    // IDOR Check & Delete: Atomic check in query
    const result = db.prepare('DELETE FROM products WHERE id = ? AND vendor_id = ?').run(productId, vendorId);

    if (result.changes === 0) {
      logAudit(vendorId, 'UNAUTHORIZED_PRODUCT_DELETE_ATTEMPT', `Vendor attempted to delete unowned or non-existent product #${productId}`, req.ip);
      return res.status(403).redirect('/vendor?error=Unauthorized or product not found.');
    }

    logAudit(vendorId, 'PRODUCT_DELETED', `Vendor deleted product #${productId}`, req.ip);
    res.redirect('/vendor?success=Product deleted successfully.');
  } catch (err) {
    console.error('Error deleting product:', err);
    res.redirect('/vendor?error=Failed to delete product.');
  }
}

function getVendorOrders(req, res) {
  try {
    const vendorId = req.session.user.id;

    // View orders containing items for THIS vendor only (protecting customer privacy and competitor data)
    const orders = db.prepare(`
      SELECT 
        o.id AS order_id, 
        o.created_at, 
        o.status AS order_status,
        o.shipping_address,
        u.name AS customer_name,
        u.email AS customer_email,
        oi.product_id,
        oi.unit_price,
        oi.quantity,
        (oi.unit_price * oi.quantity) AS item_total,
        p.title AS product_title
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN users u ON o.customer_id = u.id
      JOIN products p ON oi.product_id = p.id
      WHERE oi.vendor_id = ?
      ORDER BY o.created_at DESC
    `).all(vendorId);

    res.render('vendor/orders', {
      title: 'Vendor Orders — MarketHub',
      orders
    });
  } catch (err) {
    console.error('Error fetching vendor orders:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Failed to load vendor orders.'
    });
  }
}

module.exports = {
  getDashboard,
  renderNewProduct,
  createProduct,
  renderEditProduct,
  updateProduct,
  deleteProduct,
  getVendorOrders
};
