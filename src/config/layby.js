/**
 * Layby env (shared by services and validators).
 *
 * Defaults: 30% min deposit, no practical max (100%), balance paid in any number of
 * payments within LAYBY_PLAN_PERIOD_DAYS (90). Set LAYBY_SCHEDULED_INSTALLMENTS=true
 * for legacy fixed installment rows (uses LAYBY_INSTALLMENT_COUNT and interval options).
 */

function parseFloatEnv(key, fallback) {
    const v = process.env[key];
    if (v === undefined || String(v).trim() === '') return fallback;
    const n = parseFloat(String(v), 10);
    return Number.isNaN(n) ? fallback : n;
}

function parseIntEnv(key, fallback) {
    const v = process.env[key];
    if (v === undefined || String(v).trim() === '') return fallback;
    const n = parseInt(String(v), 10);
    return Number.isNaN(n) ? fallback : n;
}

const MIN_PCT = parseFloatEnv('LAYBY_MIN_DEPOSIT_PERCENT', 30);

const maxEnv = process.env.LAYBY_MAX_DEPOSIT_PERCENT;
const maxParsed =
    maxEnv !== undefined && String(maxEnv).trim() !== ''
        ? parseFloat(String(maxEnv), 10)
        : Number.NaN;
/** Upper deposit clamp; unset env ⇒ 100 (no cap above min other than full payment). */
const MAX_PCT = Number.isNaN(maxParsed)
    ? 100
    : Math.min(100, Math.max(MIN_PCT, maxParsed));

const PLAN_PERIOD_DAYS = Math.max(1, parseIntEnv('LAYBY_PLAN_PERIOD_DAYS', 90));

const USE_SCHEDULED_INSTALLMENTS = process.env.LAYBY_SCHEDULED_INSTALLMENTS === 'true';
const INSTALLMENT_COUNT = Math.max(1, parseIntEnv('LAYBY_INSTALLMENT_COUNT', 4));

const INTERVAL_ENV =
    process.env.LAYBY_INSTALLMENT_INTERVAL_DAYS ?? process.env.LAYBY_INSTALLMENT_INTERVAL_DAY;
const parsedInterval = parseInt(String(INTERVAL_ENV), 10);
const USE_FIXED_INSTALLMENT_INTERVAL =
    USE_SCHEDULED_INSTALLMENTS &&
    INTERVAL_ENV !== undefined &&
    String(INTERVAL_ENV).trim() !== '' &&
    !Number.isNaN(parsedInterval);
const FIXED_INTERVAL_DAYS = USE_FIXED_INSTALLMENT_INTERVAL ? Math.max(1, parsedInterval) : null;

module.exports = {
    MIN_PCT,
    MAX_PCT,
    PLAN_PERIOD_DAYS,
    USE_SCHEDULED_INSTALLMENTS,
    INSTALLMENT_COUNT,
    USE_FIXED_INSTALLMENT_INTERVAL,
    FIXED_INTERVAL_DAYS
};
