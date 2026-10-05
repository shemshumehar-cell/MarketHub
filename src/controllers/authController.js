const bcrypt = require('bcryptjs');
const { db, logAudit } = require('../config/database');
const { sanitizeInput } = require('../middleware/security');

// Email regex pattern for validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function renderLogin(req, res) {
  if (req.session?.user) {
    return res.redirect('/');
  }
  res.render('auth/login', {
    title: 'Login — MarketHub',
    error: req.query.error || null,
    success: req.query.success || null
  });
}

function renderRegister(req, res) {
  if (req.session?.user) {
    return res.redirect('/');
  }
  res.render('auth/register', {
    title: 'Register — MarketHub',
    error: req.query.error || null,
    success: req.query.success || null
  });
}

function handleRegister(req, res) {
  try {
    const name = sanitizeInput(req.body.name);
    const email = sanitizeInput(req.body.email).toLowerCase();
    const password = req.body.password || '';
    const confirmPassword = req.body.confirmPassword || '';
    const requestedRole = sanitizeInput(req.body.role).toLowerCase();

    // 1. Validation checks
    if (!name || name.length < 2 || name.length > 50) {
      return res.status(400).render('auth/register', {
        title: 'Register — MarketHub',
        error: 'Full Name must be between 2 and 50 characters.',
        values: { name, email, role: requestedRole }
      });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).render('auth/register', {
        title: 'Register — MarketHub',
        error: 'Please provide a valid email address.',
        values: { name, email, role: requestedRole }
      });
    }

    if (password.length < 8) {
      return res.status(400).render('auth/register', {
        title: 'Register — MarketHub',
        error: 'Password must be at least 8 characters long.',
        values: { name, email, role: requestedRole }
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).render('auth/register', {
        title: 'Register — MarketHub',
        error: 'Passwords do not match.',
        values: { name, email, role: requestedRole }
      });
    }

    // Security Gate: Disallow public registration of admin role (Privilege Escalation Defense)
    let assignedRole = 'customer';
    if (requestedRole === 'vendor') {
      assignedRole = 'vendor';
    } else if (requestedRole === 'admin') {
      logAudit(null, 'ADMIN_REGISTRATION_ATTEMPT_BLOCKED', `Unauthorized attempt to register admin account with email: ${email}`, req.ip);
      return res.status(403).render('auth/register', {
        title: 'Register — MarketHub',
        error: 'Security Error: Administrative roles cannot be registered through public forms.',
        values: { name, email, role: 'customer' }
      });
    }

    // 2. Check for existing email (Parameterized query)
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).render('auth/register', {
        title: 'Register — MarketHub',
        error: 'An account with this email address already exists.',
        values: { name, email, role: assignedRole }
      });
    }

    // 3. Hash password with bcrypt (salt rounds = 12)
    const salt = bcrypt.genSaltSync(12);
    const passwordHash = bcrypt.hashSync(password, salt);

    // 4. Insert user (Parameterized query)
    const insert = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, status)
      VALUES (?, ?, ?, ?, 'active')
    `);
    const result = insert.run(name, email, passwordHash, assignedRole);
    const newUserId = Number(result.lastInsertRowid);

    logAudit(newUserId, 'USER_REGISTERED', `New account created: ${email} with role ${assignedRole}`, req.ip);

    return res.redirect('/auth/login?success=Account created successfully! Please log in with your credentials.');
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).render('auth/register', {
      title: 'Register — MarketHub',
      error: 'An unexpected system error occurred. Please try again later.'
    });
  }
}

function handleLogin(req, res) {
  try {
    const email = sanitizeInput(req.body.email).toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
      return res.status(400).render('auth/login', {
        title: 'Login — MarketHub',
        error: 'Email and password are required.'
      });
    }

    // Prepared statement lookup
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      logAudit(null, 'LOGIN_FAILED', `Failed login attempt for non-existent email: ${email}`, req.ip);
      return res.status(401).render('auth/login', {
        title: 'Login — MarketHub',
        error: 'Invalid email or password.'
      });
    }

    if (user.status === 'suspended') {
      logAudit(user.id, 'SUSPENDED_LOGIN_ATTEMPT', `Suspended user attempted login: ${email}`, req.ip);
      return res.status(403).render('auth/login', {
        title: 'Login — MarketHub',
        error: 'This account has been suspended by administration.'
      });
    }

    // Verify bcrypt password
    const passwordMatches = bcrypt.compareSync(password, user.password_hash);
    if (!passwordMatches) {
      logAudit(user.id, 'LOGIN_FAILED_PASSWORD', `Failed password attempt for user: ${email}`, req.ip);
      return res.status(401).render('auth/login', {
        title: 'Login — MarketHub',
        error: 'Invalid email or password.'
      });
    }

    // Session Fixation Defense: regenerate session ID upon authentication
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.status(500).render('auth/login', {
          title: 'Login — MarketHub',
          error: 'Session creation failed.'
        });
      }

      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status
      };

      logAudit(user.id, 'LOGIN_SUCCESS', `User authenticated successfully: ${email} (${user.role})`, req.ip);

      if (user.role === 'admin') {
        return res.redirect('/admin');
      } else if (user.role === 'vendor') {
        return res.redirect('/vendor');
      } else {
        return res.redirect('/');
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).render('auth/login', {
      title: 'Login — MarketHub',
      error: 'An unexpected system error occurred. Please try again.'
    });
  }
}

function handleLogout(req, res) {
  if (req.session?.user) {
    logAudit(req.session.user.id, 'LOGOUT', `User logged out: ${req.session.user.email}`, req.ip);
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('Logout session destruction error:', err);
    }
    res.clearCookie('connect.sid');
    res.redirect('/auth/login?success=You have been logged out securely.');
  });
}

module.exports = {
  renderLogin,
  renderRegister,
  handleRegister,
  handleLogin,
  handleLogout
};
