const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize } = require('../config/mysql');
const { User, PasswordResetToken } = require('../models');
const logger = require('../utils/logger').child({ module: 'UserService' });

const EMAIL_VERIFICATION_HOURS = parseInt(process.env.CUSTOMER_EMAIL_VERIFICATION_EXPIRY_HOURS || '48', 10);
const PASSWORD_RESET_EXPIRY_MINUTES = parseInt(process.env.PASSWORD_RESET_EXPIRY_MINUTES || '60', 10);

function hashToken(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

// Keep the old name as an alias so call-sites in this file remain readable.
const hashPasswordResetToken = hashToken;

function normalizeEmail(email) {
    if (!email || typeof email !== 'string') return '';
    return email.trim().toLowerCase();
}

/**
 * @param {{ name: string, email: string, phone: string, password: string }} data
 */
async function createUser(data) {
    const email = normalizeEmail(data.email);
    const existing = await User.findOne({ where: { email } });
    if (existing) {
        const err = new Error('EMAIL_IN_USE');
        err.code = 'EMAIL_IN_USE';
        throw err;
    }

    const passwordHash = await User.hashPassword(data.password);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenHash = hashToken(verificationToken);
    const verificationExpires = new Date(Date.now() + EMAIL_VERIFICATION_HOURS * 60 * 60 * 1000);

    const user = await User.create({
        name: data.name.trim(),
        email,
        phone: data.phone.trim(),
        passwordHash,
        emailVerificationToken: verificationTokenHash,
        emailVerificationExpires: verificationExpires,
        emailVerifiedAt: null
    });

    return { user, verificationToken };
}

async function findByEmailForLogin(email) {
    const normalized = normalizeEmail(email);
    return User.scope('withPasswordHash').findOne({ where: { email: normalized } });
}

async function findById(id) {
    return User.findByPk(id);
}

/**
 * @param {number} userId
 * @param {{ name?: string, phone?: string }} data
 */
async function updateProfile(userId, data) {
    const user = await User.findByPk(userId);
    if (!user) return null;
    const updates = {};
    if (data.name !== undefined) updates.name = String(data.name).trim();
    if (data.phone !== undefined) updates.phone = (data.phone && String(data.phone).trim()) || null;
    if (Object.keys(updates).length === 0) return user;
    await user.update(updates);
    return user.reload();
}

/**
 * Mark email verified; clears verification token fields.
 * @param {string} token - raw token from email link
 */
async function verifyEmailByToken(token) {
    if (!token || typeof token !== 'string' || token.length < 32) {
        return { ok: false, reason: 'invalid' };
    }

    const tokenHash = hashToken(token);
    const user = await User.findOne({
        where: { emailVerificationToken: tokenHash }
    });

    if (!user) {
        return { ok: false, reason: 'not_found' };
    }

    if (!user.emailVerificationExpires || new Date(user.emailVerificationExpires) < new Date()) {
        return { ok: false, reason: 'expired' };
    }

    await user.update({
        emailVerifiedAt: new Date(),
        emailVerificationToken: null,
        emailVerificationExpires: null
    });

    return { ok: true, user };
}

function getPublicSiteUrl() {
    return (
        process.env.APP_PUBLIC_URL ||
        process.env.SITE_URL ||
        'http://localhost:3000'
    ).replace(/\/$/, '');
}

/**
 * Create a password reset token (stores hash only). Does not reveal whether email exists.
 * @returns {{ rawToken: string|null, user: import('sequelize').Model|null }}
 */
async function createPasswordResetRequest(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) {
        return { rawToken: null, user: null };
    }

    const user = await User.findOne({ where: { email: normalized } });
    if (!user) {
        return { rawToken: null, user: null };
    }

    await PasswordResetToken.destroy({
        where: { userId: user.id }
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashPasswordResetToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);

    await PasswordResetToken.create({
        userId: user.id,
        tokenHash,
        expiresAt
    });

    return { rawToken, user };
}

/**
 * @param {string} rawToken
 * @returns {Promise<PasswordResetToken|null>}
 */
async function findValidPasswordResetToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 32) {
        return null;
    }
    const tokenHash = hashPasswordResetToken(rawToken.trim());
    return PasswordResetToken.findOne({
        where: {
            tokenHash,
            usedAt: { [Op.is]: null },
            expiresAt: { [Op.gt]: new Date() }
        }
    });
}

/**
 * @param {string} rawToken
 * @param {string} newPassword
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function completePasswordReset(rawToken, newPassword) {
    const row = await findValidPasswordResetToken(rawToken);
    if (!row) {
        return { ok: false, reason: 'invalid_or_expired' };
    }

    try {
        await sequelize.transaction(async (t) => {
            const user = await User.scope('withPasswordHash').findByPk(row.userId, { transaction: t });
            if (!user) {
                throw new Error('USER_NOT_FOUND');
            }
            const passwordHash = await User.hashPassword(newPassword);
            await user.update({ passwordHash }, { transaction: t });
            await row.update({ usedAt: new Date() }, { transaction: t });
            await PasswordResetToken.destroy({
                where: { userId: user.id, usedAt: { [Op.is]: null } },
                transaction: t
            });
        });
        return { ok: true };
    } catch (e) {
        logger.error({ err: e, op: 'completePasswordReset' }, 'Transaction failed during password reset');
        return { ok: false, reason: 'failed' };
    }
}

module.exports = {
    normalizeEmail,
    createUser,
    findByEmailForLogin,
    findById,
    updateProfile,
    verifyEmailByToken,
    getPublicSiteUrl,
    EMAIL_VERIFICATION_HOURS,
    createPasswordResetRequest,
    findValidPasswordResetToken,
    completePasswordReset,
    PASSWORD_RESET_EXPIRY_MINUTES
};
