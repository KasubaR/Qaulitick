// Simple console logger compatible with the pino interface.
// Replaces pino to avoid Node.js version constraints (pino v10 requires Node ≥ 18.19).

const isProduction = process.env.NODE_ENV === 'production';
const configuredLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const activeLevel = LEVELS[configuredLevel] ?? LEVELS.info;

const PII_PATHS = new Set([
    'req.body',
    'req.headers.authorization',
    'customer.email',
    'customer.phone',
    'shipping.address',
    'shipping.instructions',
    'order.customer.email',
    'order.customer.phone'
]);

function redact(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = { ...obj };
    for (const path of PII_PATHS) {
        const [top, ...rest] = path.split('.');
        if (top in out) {
            if (rest.length === 0) {
                delete out[top];
            } else if (out[top] && typeof out[top] === 'object') {
                out[top] = redact(out[top]);
            }
        }
    }
    return out;
}

function log(levelName, consoleFn, args) {
    if (LEVELS[levelName] < activeLevel) return;
    const ts = new Date().toISOString();
    if (args.length === 0) return;

    let obj, msg;
    if (typeof args[0] === 'string') {
        msg = args[0];
    } else {
        obj = redact(args[0]);
        msg = args[1] || '';
    }

    const prefix = `[${ts}] ${levelName.toUpperCase()}:`;
    if (obj) {
        consoleFn(prefix, msg, obj);
    } else {
        consoleFn(prefix, msg);
    }
}

const logger = {
    trace:  (...args) => log('trace',  console.debug, args),
    debug:  (...args) => log('debug',  console.debug, args),
    info:   (...args) => log('info',   console.info,  args),
    warn:   (...args) => log('warn',   console.warn,  args),
    error:  (...args) => log('error',  console.error, args),
    fatal:  (...args) => log('fatal',  console.error, args),
    child:  () => logger, // pino .child() returns a child logger; return self for compat
};

module.exports = logger;
