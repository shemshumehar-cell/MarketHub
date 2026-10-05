const { db } = require('../config/database');

function getCart(req, res) {
  try {
    const userId = req.session.user.id;

    // Fetch user's cart items joined with products and vendor info
    const stmt = db.prepare(`
      SELECT ci.id AS cart_item_id, ci.quantity, p.id AS product_id, p.title, p.price, p.stock, p.image_url, u.name AS vendor_name
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      JOIN users u ON p.vendor_id = u.id
      WHERE ci.user_id = ?
      ORDER BY ci.created_at DESC
    `);
    const items = stmt.all(userId);

    let subtotal = 0;
    const formattedItems = items.map(item => {
      const itemTotal = item.price * item.quantity;
      subtotal += itemTotal;
      return {
        ...item,
        itemTotal: itemTotal.toFixed(2)
      };
    });

    res.render('cart/index', {
      title: 'Shopping Cart — MarketHub',
      items: formattedItems,
      subtotal: subtotal.toFixed(2),
      itemCount: items.reduce((acc, curr) => acc + curr.quantity, 0),
      error: req.query.error || null,
      success: req.query.success || null
    });
  } catch (err) {
    console.error('Error fetching cart:', err);
    res.status(500).render('errors/500', {
      title: '500 Server Error',
      message: 'Failed to load shopping cart.'
    });
  }
}

function addToCart(req, res) {
  try {
    const userId = req.session.user.id;
    const productId = parseInt(req.body.productId, 10);
    const quantity = parseInt(req.body.quantity, 10) || 1;

    if (isNaN(productId) || productId <= 0 || quantity <= 0) {
      return res.redirect('/?error=Invalid product or quantity.');
    }

    // Verify product exists, is active, and has enough stock
    const product = db.prepare('SELECT id, title, price, stock, status FROM products WHERE id = ?').get(productId);
    if (!product || product.status !== 'active') {
      return res.redirect('/?error=Product is currently unavailable.');
    }

    if (product.stock < quantity) {
      return res.redirect(`/products/${productId}?error=Requested quantity exceeds available stock (${product.stock} available).`);
    }

    // Check if item already exists in cart
    const existing = db.prepare('SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?').get(userId, productId);

    if (existing) {
      const newQty = existing.quantity + quantity;
      if (newQty > product.stock) {
        return res.redirect('/cart?error=Cannot add more. Total in cart exceeds available stock.');
      }
      db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(newQty, existing.id);
    } else {
      db.prepare('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)').run(userId, productId, quantity);
    }

    res.redirect('/cart?success=Item added to cart.');
  } catch (err) {
    console.error('Error adding to cart:', err);
    res.redirect('/cart?error=Failed to add item to cart.');
  }
}

function updateCartItem(req, res) {
  try {
    const userId = req.session.user.id;
    const cartItemId = parseInt(req.params.id, 10);
    const quantity = parseInt(req.body.quantity, 10);

    if (isNaN(cartItemId) || isNaN(quantity) || quantity <= 0) {
      return res.redirect('/cart?error=Invalid quantity.');
    }

    // Server-side Ownership Verification: Ensure this cart item belongs to the user (IDOR prevention)
    const cartItem = db.prepare(`
      SELECT ci.id, ci.product_id, p.stock
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.id = ? AND ci.user_id = ?
    `).get(cartItemId, userId);

    if (!cartItem) {
      return res.status(404).redirect('/cart?error=Cart item not found or unauthorized.');
    }

    if (quantity > cartItem.stock) {
      return res.redirect(`/cart?error=Only ${cartItem.stock} units available in stock.`);
    }

    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?').run(quantity, cartItemId, userId);
    res.redirect('/cart?success=Cart updated successfully.');
  } catch (err) {
    console.error('Error updating cart:', err);
    res.redirect('/cart?error=Failed to update cart.');
  }
}

function removeCartItem(req, res) {
  try {
    const userId = req.session.user.id;
    const cartItemId = parseInt(req.params.id, 10);

    if (isNaN(cartItemId)) {
      return res.redirect('/cart?error=Invalid item.');
    }

    // IDOR Protection: delete only if belongs to current user
    const result = db.prepare('DELETE FROM cart_items WHERE id = ? AND user_id = ?').run(cartItemId, userId);

    if (result.changes === 0) {
      return res.redirect('/cart?error=Item could not be removed.');
    }

    res.redirect('/cart?success=Item removed from cart.');
  } catch (err) {
    console.error('Error removing cart item:', err);
    res.redirect('/cart?error=Failed to remove item.');
  }
}

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem
};
