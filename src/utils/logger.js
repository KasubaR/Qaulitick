const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';

// Level-by-environment: avoid noisy `debug` logs in production.
const level = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

// Redact common PII fields if they ever appear in logged objects.
// (We still avoid logging raw `req.body` in the first place.)
const logger = pino({
  level,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.body',
      'req.headers.authorization',
      'customer.email',
      'customer.phone',
      'shipping.address',
      'shipping.instructions',
      'order.customer.email',
      'order.customer.phone'
    ],
    remove: true
  }
});

module.exports = logger;

