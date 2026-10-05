const { db, logAudit } = require('../config/database');
const { sanitizeInput } = require('../middleware/security');

function renderCheckout(req, res) {
  try {
    const userId = req.session.user.id;

    const items = db.prepare(`
      SELECT ci.quantity, p.id AS product_id, p.title, p.price, p.stock, u.name AS vendor_name
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      JOIN users u ON p.vendor_id = u.id
      WHERE ci.user_id = ?
    `).all(userId);

    if (items.length === 0) {
      return res.redirect('/cart?error=Your cart is empty. Add products before checking out.');
    }

    let subtotal = 0;
    for (const item of items) {
      if (item.quantity > item.stock) {
        return res.redirect(`/cart?error=Product "${item.title}" only has ${item.stock} in stock. Please adjust quantity.`);
      }
      subtotal += item.price * item.quantity;
    }

    res.render('orders/checkout', {
      title: 'Secure Checkout — MarketHub',
      items,
      subtotal: subtotal.toFixed(2),
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Error rendering checkout:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Failed to initialize checkout.'
    });
  }
}

function processCheckout(req, res) {
  try {
    const userId = req.session.user.id;
    const shippingAddress = sanitizeInput(req.body.shippingAddress);

    if (!shippingAddress || shippingAddress.length < 5) {
      return res.redirect('/orders/checkout?error=Please enter a valid shipping address (minimum 5 characters).');
    }

    // Fetch cart items
    const cartItems = db.prepare(`
      SELECT ci.quantity, p.id AS product_id, p.title, p.price, p.stock, p.vendor_id
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = ?
    `).all(userId);

    if (cartItems.length === 0) {
      return res.redirect('/cart?error=Your cart is empty.');
    }

    // Atomic Checkout Transaction
    db.exec('BEGIN TRANSACTION;');

    try {
      let totalAmount = 0;

      // 1. Verify stock for each item under transaction
      for (const item of cartItems) {
        const currentProd = db.prepare('SELECT stock, status FROM products WHERE id = ?').get(item.product_id);
        if (!currentProd || currentProd.status !== 'active') {
          throw new Error(`Product "${item.title}" is no longer available.`);
        }
        if (currentProd.stock < item.quantity) {
          throw new Error(`Insufficient stock for "${item.title}". Only ${currentProd.stock} remaining.`);
        }
        totalAmount += item.price * item.quantity;
      }

      // 2. Create the master order
      const insertOrder = db.prepare(`
        INSERT INTO orders (customer_id, total_amount, status, shipping_address)
        VALUES (?, ?, 'paid', ?)
      `);
      const orderResult = insertOrder.run(userId, totalAmount, shippingAddress);
      const orderId = Number(orderResult.lastInsertRowid);

      // 3. Create order items and decrement stock
      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, vendor_id, unit_price, quantity)
        VALUES (?, ?, ?, ?, ?)
      `);
      const updateStock = db.prepare(`
        UPDATE products SET stock = stock - ? WHERE id = ?
      `);

      for (const item of cartItems) {
        insertItem.run(orderId, item.product_id, item.vendor_id, item.price, item.quantity);
        updateStock.run(item.quantity, item.product_id);
      }

      // 4. Clear user's cart
      db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);

      db.exec('COMMIT;');

      logAudit(userId, 'ORDER_PLACED', `Order #${orderId} completed successfully. Total: $${totalAmount.toFixed(2)}`, req.ip);

      return res.redirect(`/orders/${orderId}?success=Order placed successfully! Mock payment received.`);
    } catch (txErr) {
      db.exec('ROLLBACK;');
      console.error('Checkout transaction aborted:', txErr.message);
      return res.redirect(`/cart?error=${encodeURIComponent(txErr.message)}`);
    }
  } catch (err) {
    console.error('Error processing checkout:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Checkout could not be completed.'
    });
  }
}

function listOrders(req, res) {
  try {
    const userId = req.session.user.id;

    // Fetch all customer orders (Parameterized query)
    const orders = db.prepare(`
      SELECT o.*, COUNT(oi.id) AS total_items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.customer_id = ?
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `).all(userId);

    res.render('orders/index', {
      title: 'My Orders — MarketHub',
      orders
    });
  } catch (err) {
    console.error('Error listing orders:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Failed to load order history.'
    });
  }
}

function getOrderDetails(req, res) {
  try {
    const userId = req.session.user.id;
    const orderId = parseInt(req.params.id, 10);

    if (isNaN(orderId)) {
      return res.status(404).render('errors/404', {
        title: 'Order Not Found',
        message: 'Invalid order number.'
      });
    }

    // Retrieve order
    const order = db.prepare(`
      SELECT o.*, u.name AS customer_name, u.email AS customer_email
      FROM orders o
      JOIN users u ON o.customer_id = u.id
      WHERE o.id = ?
    `).get(orderId);

    if (!order) {
      return res.status(404).render('errors/404', {
        title: 'Order Not Found',
        message: 'Order does not exist.'
      });
    }

    // Insecure Direct Object Reference (IDOR) Defense:
    // Only the order's customer OR an admin may view full customer receipt
    const isOwner = order.customer_id === userId;
    const isAdmin = req.session.user.role === 'admin';

    if (!isOwner && !isAdmin) {
      logAudit(userId, 'UNAUTHORIZED_ORDER_ACCESS', `User ${userId} attempted to view Order #${orderId} belonging to user ${order.customer_id}`, req.ip);
      return res.status(403).render('errors/403', {
        title: '403 Forbidden',
        message: 'Security Alert: You are not authorized to view this order.'
      });
    }

    // Fetch order line items
    const items = db.prepare(`
      SELECT oi.*, p.title AS product_title, p.image_url, u.name AS vendor_name
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN users u ON oi.vendor_id = u.id
      WHERE oi.order_id = ?
    `).all(orderId);

    res.render('orders/show', {
      title: `Order #${order.id} — MarketHub`,
      order,
      items,
      success: req.query.success || null
    });
  } catch (err) {
    console.error('Error getting order details:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Unable to retrieve order details.'
    });
  }
}

module.exports = {
  renderCheckout,
  processCheckout,
  listOrders,
  getOrderDetails
};
