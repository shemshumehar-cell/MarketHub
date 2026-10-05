const { db } = require('../config/database');
const { sanitizeInput } = require('../middleware/security');

function listProducts(req, res) {
  try {
    const search = sanitizeInput(req.query.q || '');
    const categorySlug = sanitizeInput(req.query.category || '');
    const sort = sanitizeInput(req.query.sort || 'newest');

    // Fetch all categories for filter dropdown
    const categories = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();

    // Base query using prepared statements
    let query = `
      SELECT p.*, u.name AS vendor_name, c.name AS category_name, c.slug AS category_slug
      FROM products p
      JOIN users u ON p.vendor_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.status = 'active' AND u.status = 'active'
    `;
    const params = [];

    if (search) {
      // Secure parameterized LIKE search (prevents SQL injection)
      query += ` AND (p.title LIKE ? OR p.description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (categorySlug) {
      query += ` AND c.slug = ?`;
      params.push(categorySlug);
    }

    // Sort order validation whitelist
    if (sort === 'price_asc') {
      query += ` ORDER BY p.price ASC`;
    } else if (sort === 'price_desc') {
      query += ` ORDER BY p.price DESC`;
    } else {
      query += ` ORDER BY p.created_at DESC`;
    }

    const stmt = db.prepare(query);
    const products = stmt.all(...params);

    res.render('index', {
      title: 'MarketHub — Secure Multi-Vendor Marketplace',
      products,
      categories,
      selectedCategory: categorySlug,
      searchQuery: search,
      selectedSort: sort
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Failed to load products.'
    });
  }
}

function getProductDetails(req, res) {
  try {
    const productId = parseInt(req.params.id, 10);
    if (isNaN(productId) || productId <= 0) {
      return res.status(404).render('errors/404', {
        title: 'Product Not Found',
        message: 'The requested product does not exist.'
      });
    }

    const stmt = db.prepare(`
      SELECT p.*, u.name AS vendor_name, u.email AS vendor_email, c.name AS category_name
      FROM products p
      JOIN users u ON p.vendor_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id = ?
    `);
    const product = stmt.get(productId);

    if (!product) {
      return res.status(404).render('errors/404', {
        title: 'Product Not Found',
        message: 'The requested product was not found in our marketplace.'
      });
    }

    // Check if delisted and user is not admin/vendor
    if (product.status !== 'active') {
      const isOwner = req.session?.user && req.session.user.id === product.vendor_id;
      const isAdmin = req.session?.user && req.session.user.role === 'admin';
      if (!isOwner && !isAdmin) {
        return res.status(404).render('errors/404', {
          title: 'Product Unavailable',
          message: 'This product is currently inactive or delisted.'
        });
      }
    }

    res.render('products/show', {
      title: `${product.title} — MarketHub`,
      product
    });
  } catch (err) {
    console.error('Error retrieving product details:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Unable to retrieve product details.'
    });
  }
}

module.exports = {
  listProducts,
  getProductDetails
};
