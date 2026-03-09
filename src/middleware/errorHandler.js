// src/middleware/errorHandler.js
const logger = require('../config/logger');

function notFound(req, res) {
  res.status(404).json({ error: 'NotFound', message: `${req.method} ${req.path} not found` });
}

function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  logger.error(err.message, { stack: err.stack, path: req.path });
  res.status(status).json({
    error: status === 500 ? 'InternalServerError' : err.name || 'Error',
    message: status === 500 ? 'Something went wrong.' : err.message,
  });
}

module.exports = { notFound, errorHandler };
