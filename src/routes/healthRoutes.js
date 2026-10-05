const express = require('express');
const router = express.Router();
const { db } = require('../config/database');

router.get('/health', (req, res) => {
  try {
    // Quick probe to verify database connectivity
    const probe = db.prepare('SELECT 1 AS ok').get();
    
    res.status(200).json({
      status: 'healthy',
      service: 'MarketHub',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      database: probe?.ok === 1 ? 'connected' : 'degraded',
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
