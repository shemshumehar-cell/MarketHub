const { db, logAudit } = require('../config/database');
const { sanitizeInput } = require('../middleware/security');

function getDashboard(req, res) {
  try {
    const totalUsers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'customer'").get().count;
    const totalVendors = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'vendor'").get().count;
    const totalProducts = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
    const orderStats = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS revenue FROM orders").get();

    // Latest audit events
    const recentLogs = db.prepare(`
      SELECT al.*, u.email AS user_email
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ORDER BY al.created_at DESC
      LIMIT 10
    `).all();

    res.render('admin/dashboard', {
      title: 'Admin Control Center — MarketHub',
      metrics: {
        totalUsers,
        totalVendors,
        totalProducts,
        totalOrders: orderStats.count,
        totalRevenue: Number(orderStats.revenue).toFixed(2)
      },
      recentLogs,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Error loading admin dashboard:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Failed to load administrative dashboard.'
    });
  }
}

function listUsers(req, res) {
  try {
    const users = db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.status, u.created_at,
             (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id) AS order_count,
             (SELECT COUNT(*) FROM products p WHERE p.vendor_id = u.id) AS product_count
      FROM users u
      ORDER BY u.created_at DESC
    `).all();

    res.render('admin/users', {
      title: 'User Management — MarketHub Admin',
      users,
      currentAdminId: req.session.user.id,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Error listing users:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Failed to retrieve user list.'
    });
  }
}

function toggleUserStatus(req, res) {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const adminId = req.session.user.id;

    // Safety constraint: Prevent admin from locking out their own account
    if (targetUserId === adminId) {
      return res.redirect('/admin/users?error=Security constraint: You cannot suspend your own active administrator account.');
    }

    const user = db.prepare('SELECT id, email, status FROM users WHERE id = ?').get(targetUserId);
    if (!user) {
      return res.redirect('/admin/users?error=User not found.');
    }

    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, targetUserId);

    logAudit(adminId, 'USER_STATUS_CHANGED', `Admin changed user status of ${user.email} (#${targetUserId}) to ${newStatus}`, req.ip);

    res.redirect(`/admin/users?success=User status updated to ${newStatus}.`);
  } catch (err) {
    console.error('Error toggling user status:', err);
    res.redirect('/admin/users?error=Failed to update user status.');
  }
}

function changeUserRole(req, res) {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const adminId = req.session.user.id;
    const newRole = sanitizeInput(req.body.role);

    if (!['customer', 'vendor', 'admin'].includes(newRole)) {
      return res.redirect('/admin/users?error=Invalid role.');
    }

    if (targetUserId === adminId && newRole !== 'admin') {
      return res.redirect('/admin/users?error=Security constraint: You cannot demote yourself.');
    }

    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(targetUserId);
    if (!user) {
      return res.redirect('/admin/users?error=User not found.');
    }

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, targetUserId);

    logAudit(adminId, 'USER_ROLE_CHANGED', `Admin changed role of ${user.email} (#${targetUserId}) to ${newRole}`, req.ip);

    res.redirect(`/admin/users?success=User role updated to ${newRole}.`);
  } catch (err) {
    console.error('Error updating role:', err);
    res.redirect('/admin/users?error=Failed to update role.');
  }
}

function listProducts(req, res) {
  try {
    const products = db.prepare(`
      SELECT p.*, u.name AS vendor_name, u.email AS vendor_email, c.name AS category_name
      FROM products p
      JOIN users u ON p.vendor_id = u.id
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.created_at DESC
    `).all();

    res.render('admin/products', {
      title: 'Product Moderation — MarketHub Admin',
      products,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Error listing products for admin:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Failed to retrieve products.'
    });
  }
}

function toggleProductStatus(req, res) {
  try {
    const productId = parseInt(req.params.id, 10);
    const adminId = req.session.user.id;

    const product = db.prepare('SELECT id, title, status FROM products WHERE id = ?').get(productId);
    if (!product) {
      return res.redirect('/admin/products?error=Product not found.');
    }

    const newStatus = product.status === 'active' ? 'delisted' : 'active';
    db.prepare('UPDATE products SET status = ? WHERE id = ?').run(newStatus, productId);

    logAudit(adminId, 'PRODUCT_MODERATED', `Admin changed status of product #${productId} (${product.title}) to ${newStatus}`, req.ip);

    res.redirect(`/admin/products?success=Product status updated to ${newStatus}.`);
  } catch (err) {
    console.error('Error toggling product status:', err);
    res.redirect('/admin/products?error=Failed to update product status.');
  }
}

function listOrders(req, res) {
  try {
    const orders = db.prepare(`
      SELECT o.*, u.name AS customer_name, u.email AS customer_email,
             COUNT(oi.id) AS item_count
      FROM orders o
      JOIN users u ON o.customer_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `).all();

    res.render('admin/orders', {
      title: 'Order Monitoring — MarketHub Admin',
      orders,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Error listing orders for admin:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Failed to load orders.'
    });
  }
}

function updateOrderStatus(req, res) {
  try {
    const orderId = parseInt(req.params.id, 10);
    const newStatus = sanitizeInput(req.body.status);
    const adminId = req.session.user.id;

    if (!['pending', 'paid', 'shipped', 'delivered', 'cancelled'].includes(newStatus)) {
      return res.redirect('/admin/orders?error=Invalid status.');
    }

    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(newStatus, orderId);

    logAudit(adminId, 'ORDER_STATUS_CHANGED', `Admin changed status of Order #${orderId} to ${newStatus}`, req.ip);

    res.redirect(`/admin/orders?success=Order #${orderId} status set to ${newStatus}.`);
  } catch (err) {
    console.error('Error updating order status:', err);
    res.redirect('/admin/orders?error=Failed to update order status.');
  }
}

function listAuditLogs(req, res) {
  try {
    const logs = db.prepare(`
      SELECT al.*, u.email AS user_email, u.role AS user_role
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ORDER BY al.created_at DESC
      LIMIT 100
    `).all();

    res.render('admin/logs', {
      title: 'Security Audit Logs — MarketHub Admin',
      logs
    });
  } catch (err) {
    console.error('Error loading audit logs:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Failed to load security audit logs.'
    });
  }
}

module.exports = {
  getDashboard,
  listUsers,
  toggleUserStatus,
  changeUserRole,
  listProducts,
  toggleProductStatus,
  listOrders,
  updateOrderStatus,
  listAuditLogs
};
