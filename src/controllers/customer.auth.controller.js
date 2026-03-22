/**
 * Storefront customer auth.
 * Do not log raw registration/forgot/reset bodies, passwords, or email/reset tokens — use structured
 * logs ({ err, op }) only so PII and secrets never appear in log streams.
 */
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const userService = require('../services/user.service');
const emailService = require('../services/email.service');
const {
    sanitizeString,
    sanitizeObject,
    validateRegister,
    validateLogin,
    validateForgotPasswordEmail,
    validateResetPassword
} = require('../utils/validators');
const { cookieName: sessionCookieName } = require('../config/session.constants');
const logger = require('../utils/logger').child({ module: 'CustomerAuthController' });

const REMEMBER_MAX_AGE_MS = parseInt(
    process.env.SESSION_REMEMBER_MAX_AGE || String(30 * 24 * 60 * 60 * 1000),
    10
);

// Used to normalise bcrypt timing when no user is found, preventing email enumeration via response time.
const DUMMY_HASH = '$2b$10$invalidhashfortimingnormalizationXXXXXXXXXXXXXXXXX';

function parseRememberMe(body) {
    const v = body.remember;
    return v === 'on' || v === true || v === 'true' || v === '1';
}

exports.renderRegisterPage = (req, res) => {
    if (req.session.userId) {
        return res.redirect('/account');
    }
    res.render('account/register', {
        title: 'Create account | Qualitick Collections',
        page: 'account',
        accountSection: 'register',
        error: null,
        form: { name: '', email: '', phone: '' },
        csrfToken: res.locals.csrfToken || ''
    });
};

exports.handleRegister = async (req, res) => {
    try {
        if (req.session.userId) {
            return res.redirect('/account');
        }

        const body = sanitizeObject(req.body);
        const validation = validateRegister(body);
        if (!validation.valid) {
            return res.status(400).render('account/register', {
                title: 'Create account | Qualitick Collections',
                page: 'account',
                accountSection: 'register',
                error: validation.errors.join(' '),
                form: {
                    name: body.name || '',
                    email: body.email || '',
                    phone: body.phone || ''
                },
                csrfToken: res.locals.csrfToken || ''
            });
        }

        let verificationToken;
        try {
            const created = await userService.createUser({
                name: body.name,
                email: body.email,
                phone: body.phone,
                password: body.password
            });
            verificationToken = created.verificationToken;
        } catch (e) {
            if (e.code === 'EMAIL_IN_USE') {
                return res.status(409).render('account/register', {
                    title: 'Create account | Qualitick Collections',
                    page: 'account',
                    accountSection: 'register',
                    error: 'An account with this email already exists. Try signing in.',
                    form: {
                        name: body.name || '',
                        email: '',
                        phone: body.phone || ''
                    },
                    csrfToken: res.locals.csrfToken || ''
                });
            }
            throw e;
        }

        const baseUrl = userService.getPublicSiteUrl();
        const verifyUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`;
        const sendVerification = process.env.CUSTOMER_EMAIL_VERIFICATION !== 'false';
        if (sendVerification) {
            try {
                await emailService.sendCustomerEmailVerification({
                    to: userService.normalizeEmail(body.email),
                    name: body.name.trim(),
                    verifyUrl
                });
            } catch (mailErr) {
                logger.warn({ err: mailErr }, 'Verification email send failed (user still created)');
            }
        }

        return res.redirect('/login?message=' + encodeURIComponent(
            'Account created. Check your email to verify your address before using layby at checkout.'
        ));
    } catch (error) {
        logger.error({ err: error, op: 'handleRegister' }, 'handleRegister failed');
        res.status(500).render('account/register', {
            title: 'Create account | Qualitick Collections',
            page: 'account',
            accountSection: 'register',
            error: 'Something went wrong. Please try again later.',
            form: { name: '', email: '', phone: '' },
            csrfToken: res.locals.csrfToken || ''
        });
    }
};

exports.renderLoginPage = (req, res) => {
    if (req.session.userId) {
        return res.redirect('/account');
    }
    res.render('account/login', {
        title: 'Sign in | Qualitick Collections',
        page: 'account',
        accountSection: 'login',
        error: req.query.error ? sanitizeString(req.query.error) : null,
        message: req.query.message ? sanitizeString(req.query.message) : null,
        returnUrl: typeof req.query.returnUrl === 'string' && req.query.returnUrl.startsWith('/') && !req.query.returnUrl.startsWith('//') ? req.query.returnUrl : '/account',
        csrfToken: res.locals.csrfToken || ''
    });
};

exports.handleLogin = async (req, res) => {
    try {
        if (req.session.userId) {
            return res.redirect('/account');
        }

        const body = sanitizeObject(req.body);
        const validation = validateLogin(body);
        if (!validation.valid) {
            return res.status(400).render('account/login', {
                title: 'Sign in | Qualitick Collections',
                page: 'account',
                accountSection: 'login',
                error: validation.errors.join(' '),
                message: null,
                returnUrl: body.returnUrl || '/account',
                csrfToken: res.locals.csrfToken || ''
            });
        }

        const user = await userService.findByEmailForLogin(body.email);
        const passwordMatch = user
            ? await user.comparePassword(body.password)
            : await bcrypt.compare(body.password, DUMMY_HASH);
        if (!user || !passwordMatch) {
            return res.status(401).render('account/login', {
                title: 'Sign in | Qualitick Collections',
                page: 'account',
                accountSection: 'login',
                error: 'Invalid email or password.',
                message: null,
                returnUrl: body.returnUrl || '/account',
                csrfToken: res.locals.csrfToken || ''
            });
        }

        const remember = parseRememberMe(body);
        const returnUrl = (() => {
            try {
                const decoded = decodeURIComponent(typeof body.returnUrl === 'string' ? body.returnUrl : '');
                return decoded.startsWith('/') && !decoded.startsWith('//') ? decoded : '/account';
            } catch {
                return '/account';
            }
        })();

        req.session.regenerate((regErr) => {
            if (regErr) {
                logger.error({ err: regErr }, 'session regenerate on login failed');
                return res.status(500).render('account/login', {
                    title: 'Sign in | Qualitick Collections',
                    page: 'account',
                    accountSection: 'login',
                    error: 'Could not start session. Please try again.',
                    message: null,
                    returnUrl,
                    csrfToken: res.locals.csrfToken || ''
                });
            }

            req.session.userId = user.id;
            req.session.csrfToken = crypto.randomBytes(32).toString('hex');
            req.session.cookie.maxAge = remember ? REMEMBER_MAX_AGE_MS : null;

            req.session.save((saveErr) => {
                if (saveErr) {
                    logger.error({ err: saveErr }, 'session save on login failed');
                    return res.status(500).render('account/login', {
                        title: 'Sign in | Qualitick Collections',
                        page: 'account',
                        accountSection: 'login',
                        error: 'Could not save session. Please try again.',
                        message: null,
                        returnUrl,
                        csrfToken: res.locals.csrfToken || ''
                    });
                }
                return res.redirect(returnUrl);
            });
        });
    } catch (error) {
        logger.error({ err: error, op: 'handleLogin' }, 'handleLogin failed');
        res.status(500).render('account/login', {
            title: 'Sign in | Qualitick Collections',
            page: 'account',
            accountSection: 'login',
            error: 'Something went wrong. Please try again later.',
            message: null,
            returnUrl: '/account',
            csrfToken: res.locals.csrfToken || ''
        });
    }
};

exports.handleLogout = (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            logger.error({ err }, 'customer session destroy failed');
            return res.status(500).render('account/login', {
                title: 'Sign in | Qualitick Collections',
                page: 'account',
                accountSection: 'login',
                error: 'Could not sign you out. Please try again.',
                message: null,
                returnUrl: '/account',
                csrfToken: ''
            });
        }
        res.clearCookie(sessionCookieName, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            path: '/'
        });
        res.redirect('/login?message=' + encodeURIComponent('You have been signed out.'));
    });
};

exports.renderForgotPasswordPage = (req, res) => {
    if (req.session.userId) {
        return res.redirect('/account');
    }
    res.render('account/forgot-password', {
        title: 'Forgot password | Qualitick Collections',
        page: 'account',
        accountSection: 'forgot',
        error: null,
        message: req.query.message || null,
        form: { email: '' },
        csrfToken: res.locals.csrfToken || ''
    });
};

exports.handleForgotPassword = async (req, res) => {
    try {
        if (req.session.userId) {
            return res.redirect('/account');
        }

        const body = sanitizeObject(req.body);
        const validation = validateForgotPasswordEmail(body);
        if (!validation.valid) {
            return res.status(400).render('account/forgot-password', {
                title: 'Forgot password | Qualitick Collections',
                page: 'account',
                accountSection: 'forgot',
                error: validation.errors.join(' '),
                message: null,
                form: { email: body.email || '' },
                csrfToken: res.locals.csrfToken || ''
            });
        }

        const { rawToken, user } = await userService.createPasswordResetRequest(body.email);
        if (rawToken && user) {
            const baseUrl = userService.getPublicSiteUrl();
            const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
            try {
                await emailService.sendCustomerPasswordResetEmail({
                    to: user.email,
                    name: user.name || user.email,
                    resetUrl
                });
            } catch (mailErr) {
                logger.warn({ err: mailErr }, 'Password reset email send failed');
            }
        }

        return res.redirect('/forgot-password?message=' + encodeURIComponent(
            'If an account exists for that email, you will receive reset instructions shortly.'
        ));
    } catch (error) {
        logger.error({ err: error, op: 'handleForgotPassword' }, 'handleForgotPassword failed');
        return res.status(500).render('account/forgot-password', {
            title: 'Forgot password | Qualitick Collections',
            page: 'account',
            accountSection: 'forgot',
            error: 'Something went wrong. Please try again later.',
            message: null,
            form: { email: '' },
            csrfToken: res.locals.csrfToken || ''
        });
    }
};

exports.renderResetPasswordPage = async (req, res) => {
    try {
        if (req.session.userId) {
            return res.redirect('/account');
        }

        const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
        if (!token) {
            return res.status(400).render('account/reset-password', {
                title: 'Reset password | Qualitick Collections',
                page: 'account',
                accountSection: 'reset',
                invalid: true,
                token: null,
                error: 'This reset link is missing a token. Request a new link below.',
                csrfToken: res.locals.csrfToken || ''
            });
        }

        const row = await userService.findValidPasswordResetToken(token);
        if (!row) {
            return res.status(400).render('account/reset-password', {
                title: 'Reset password | Qualitick Collections',
                page: 'account',
                accountSection: 'reset',
                invalid: true,
                token: null,
                error: 'This reset link is invalid or has expired. Please request a new one.',
                csrfToken: res.locals.csrfToken || ''
            });
        }

        return res.render('account/reset-password', {
            title: 'Reset password | Qualitick Collections',
            page: 'account',
            accountSection: 'reset',
            invalid: false,
            token,
            error: null,
            csrfToken: res.locals.csrfToken || ''
        });
    } catch (error) {
        logger.error({ err: error, op: 'renderResetPasswordPage' }, 'renderResetPasswordPage failed');
        return res.status(500).render('account/reset-password', {
            title: 'Reset password | Qualitick Collections',
            page: 'account',
            accountSection: 'reset',
            invalid: true,
            token: null,
            error: 'Something went wrong. Please try again.',
            csrfToken: res.locals.csrfToken || ''
        });
    }
};

exports.handleResetPassword = async (req, res) => {
    try {
        if (req.session.userId) {
            return res.redirect('/account');
        }

        const body = sanitizeObject(req.body);
        const validation = validateResetPassword(body);
        if (!validation.valid) {
            const token = typeof body.token === 'string' ? body.token.trim() : '';
            return res.status(400).render('account/reset-password', {
                title: 'Reset password | Qualitick Collections',
                page: 'account',
                accountSection: 'reset',
                invalid: false,
                token: token || null,
                error: validation.errors.join(' '),
                csrfToken: res.locals.csrfToken || ''
            });
        }

        const result = await userService.completePasswordReset(body.token.trim(), body.password);
        if (!result.ok) {
            return res.status(400).render('account/reset-password', {
                title: 'Reset password | Qualitick Collections',
                page: 'account',
                accountSection: 'reset',
                invalid: true,
                token: null,
                error: 'This reset link is invalid or has expired. Please request a new one.',
                csrfToken: res.locals.csrfToken || ''
            });
        }

        req.session.destroy((err) => {
            if (err) {
                logger.error({ err }, 'session destroy after password reset failed');
            }
            res.clearCookie(sessionCookieName, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                path: '/'
            });
            res.redirect('/login?message=' + encodeURIComponent(
                'Your password was reset. Sign in with your new password.'
            ));
        });
    } catch (error) {
        logger.error({ err: error, op: 'handleResetPassword' }, 'handleResetPassword failed');
        res.status(500).render('account/reset-password', {
            title: 'Reset password | Qualitick Collections',
            page: 'account',
            accountSection: 'reset',
            invalid: true,
            token: null,
            error: 'Something went wrong. Please try again.',
            csrfToken: res.locals.csrfToken || ''
        });
    }
};

exports.verifyEmail = async (req, res) => {
    try {
        const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
        const result = await userService.verifyEmailByToken(token);

        if (!result.ok) {
            const msg =
                result.reason === 'expired'
                    ? 'This verification link has expired. Sign in and contact support if you need help.'
                    : 'Invalid or expired verification link.';
            return res.status(400).render('account/verify-email-result', {
                title: 'Email verification | Qualitick Collections',
                page: 'account',
                accountSection: 'verify',
                success: false,
                message: msg
            });
        }

        res.render('account/verify-email-result', {
            title: 'Email verified | Qualitick Collections',
            page: 'account',
            accountSection: 'verify',
            success: true,
            message: 'Your email is verified. You can use layby at checkout when logged in.'
        });
    } catch (error) {
        logger.error({ err: error, op: 'verifyEmail' }, 'verifyEmail failed');
        return res.status(500).render('account/verify-email-result', {
            title: 'Email verification | Qualitick Collections',
            page: 'account',
            accountSection: 'verify',
            success: false,
            message: 'Something went wrong. Please try again later.'
        });
    }
};
