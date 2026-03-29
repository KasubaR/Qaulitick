const crypto = require('crypto');
const { sequelize } = require('../config/mysql');
const { UniqueConstraintError } = require('sequelize');
const NewsletterSubscriber = require('../models/NewsletterSubscriber.model');
const NewsletterSubscribeAttempt = require('../models/NewsletterSubscribeAttempt.model');
const logger = require('../utils/logger').child({ module: 'NewsletterService' });

const ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

function generateUnsubscribeToken() {
    return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function normalizeEmail(email) {
    if (typeof email !== 'string') return '';
    return email.trim().toLowerCase();
}

function msSince(date) {
    return Date.now() - new Date(date).getTime();
}

/**
 * Normalize and validate unsubscribe token query value (64 hex chars).
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeUnsubscribeToken(raw) {
    if (typeof raw !== 'string') return null;
    const t = raw.trim().toLowerCase();
    if (t.length !== TOKEN_BYTES * 2 || !/^[a-f0-9]+$/.test(t)) return null;
    return t;
}

/**
 * Mark subscriber unsubscribed by secret token. Invalid or unknown tokens are ignored (no throw).
 * @param {unknown} rawToken
 * @returns {Promise<void>}
 */
async function unsubscribeByToken(rawToken) {
    const token = normalizeUnsubscribeToken(rawToken);
    if (!token) return;

    const row = await NewsletterSubscriber.findOne({ where: { unsubscribeToken: token } });
    if (!row || row.status === 'unsubscribed') return;

    const now = new Date();
    await row.update({
        status: 'unsubscribed',
        unsubscribedAt: now
    });
}

/**
 * Subscribe an email. All logical outcomes are success from the caller’s perspective
 * (uniform HTTP 200 + same message in the controller). Returns flags for side effects only.
 *
 * @param {string} rawEmail
 * @param {object} [options]
 * @param {string} [options.source='home']
 * @returns {Promise<{ sendWelcome: boolean, unsubscribeToken: string | null }>}
 */
async function subscribe(rawEmail, options = {}) {
    const email = normalizeEmail(rawEmail);
    const source = typeof options.source === 'string' && options.source.trim()
        ? options.source.trim().slice(0, 50)
        : 'home';

    return sequelize.transaction(async (transaction) => {
        const now = new Date();
        let welcomeToken = null;

        const [attempt, attemptCreated] = await NewsletterSubscribeAttempt.findOrCreate({
            where: { email },
            defaults: { email, lastAttemptAt: now },
            transaction
        });

        const withinWindow =
            !attemptCreated && msSince(attempt.lastAttemptAt) < ATTEMPT_WINDOW_MS;

        if (withinWindow) {
            const subscriber = await NewsletterSubscriber.findOne({
                where: { email },
                transaction
            });

            if (subscriber && subscriber.status === 'active') {
                return { sendWelcome: false, unsubscribeToken: null };
            }

            if (subscriber && subscriber.status === 'unsubscribed') {
                const newToken = generateUnsubscribeToken();
                await subscriber.update(
                    {
                        status: 'active',
                        subscribedAt: now,
                        source,
                        unsubscribeToken: newToken,
                        unsubscribedAt: null
                    },
                    { transaction }
                );
                return { sendWelcome: false, unsubscribeToken: null };
            }

            if (!subscriber) {
                try {
                    const newToken = generateUnsubscribeToken();
                    await NewsletterSubscriber.create(
                        {
                            email,
                            status: 'active',
                            subscribedAt: now,
                            source,
                            unsubscribeToken: newToken
                        },
                        { transaction }
                    );
                    welcomeToken = newToken;
                } catch (err) {
                    if (err instanceof UniqueConstraintError) {
                        return { sendWelcome: false, unsubscribeToken: null };
                    }
                    throw err;
                }
                return { sendWelcome: true, unsubscribeToken: welcomeToken };
            }
        }

        if (!attemptCreated && !withinWindow) {
            await attempt.update({ lastAttemptAt: now }, { transaction });
        }

        const subscriber = await NewsletterSubscriber.findOne({
            where: { email },
            transaction
        });

        if (subscriber && subscriber.status === 'active') {
            return { sendWelcome: false, unsubscribeToken: null };
        }

        if (subscriber && subscriber.status === 'unsubscribed') {
            const newToken = generateUnsubscribeToken();
            await subscriber.update(
                {
                    status: 'active',
                    subscribedAt: now,
                    source,
                    unsubscribeToken: newToken,
                    unsubscribedAt: null
                },
                { transaction }
            );
            return { sendWelcome: true, unsubscribeToken: newToken };
        }

        try {
            const newToken = generateUnsubscribeToken();
            await NewsletterSubscriber.create(
                {
                    email,
                    status: 'active',
                    subscribedAt: now,
                    source,
                    unsubscribeToken: newToken
                },
                { transaction }
            );
            welcomeToken = newToken;
        } catch (err) {
            if (err instanceof UniqueConstraintError) {
                return { sendWelcome: false, unsubscribeToken: null };
            }
            throw err;
        }

        return { sendWelcome: true, unsubscribeToken: welcomeToken };
    }).catch((err) => {
        logger.error({ err: err.message }, 'newsletter subscribe failed');
        throw err;
    });
}

module.exports = {
    subscribe,
    unsubscribeByToken,
    normalizeEmail,
    ATTEMPT_WINDOW_MS,
    generateUnsubscribeToken
};
