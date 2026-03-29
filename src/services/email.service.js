const nodemailer = require('nodemailer');
require('dotenv').config();
const settingsService = require('./settings.service');
const logger = require('../utils/logger').child({ module: 'EmailService' });

/**
 * Email Service
 * 
 * Handles all email sending operations using Gmail SMTP
 * Integrates with notification settings to respect user preferences
 */

// SMTP Configuration — prefers cPanel SMTP_* vars, falls back to Gmail
const createTransporter = () => {
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    const gmailUser = process.env.GMAIL_USER;
    const gmailPassword = process.env.GMAIL_APP_PASSWORD;

    const useCpanel = smtpHost && smtpUser && smtpPass;
    const useGmail = gmailUser && gmailPassword;

    if (!useCpanel && !useGmail) {
        logger.warn('No SMTP credentials configured. Email functionality will be disabled.');
        return null;
    }

    if (useCpanel) {
        const port = parseInt(process.env.SMTP_PORT || '465', 10);
        const secure = process.env.SMTP_SECURE !== 'false'; // default true for port 465
        logger.info({ host: smtpHost, port, secure }, 'Using cPanel SMTP');
        return nodemailer.createTransport({
            host: smtpHost,
            port,
            secure,
            auth: { user: smtpUser, pass: smtpPass },
            tls: { rejectUnauthorized: false },
            pool: true,
            maxConnections: 5,
            rateDelta: 1000,
            rateLimit: 5
        });
    }

    // Fallback: Gmail
    const tlsOptions = {};
    if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_INSECURE_EMAIL === 'true') {
        tlsOptions.rejectUnauthorized = false;
        logger.warn('SSL cert validation disabled. Development only.');
    }
    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: gmailUser, pass: gmailPassword },
        pool: true,
        maxConnections: 5,
        rateDelta: 1000,
        rateLimit: 5,
        tls: Object.keys(tlsOptions).length > 0 ? tlsOptions : undefined
    });
};

// Lazy transporter: created on first use so env vars loaded after this module is
// first imported (e.g. via dotenv in a different require order) are always visible.
// A new transporter is created each time credentials are missing or after a
// send failure so a stale/broken connection does not persist across restarts.
let _transporter;

function resetTransporter() {
    if (_transporter) {
        try { _transporter.close(); } catch (_) { /* ignore */ }
    }
    _transporter = null;
}

function getTransporter() {
    if (!_transporter) {
        const raw = createTransporter();
        if (!raw) return null;
        // Wrap sendMail so any transport-level error clears the cached instance,
        // forcing a fresh connection on the next attempt.
        _transporter = Object.create(raw);
        _transporter.sendMail = async function(...args) {
            try {
                return await raw.sendMail.apply(raw, args);
            } catch (err) {
                resetTransporter();
                throw err;
            }
        };
    }
    return _transporter;
}

/**
 * Verify SMTP credentials eagerly at startup.
 * Call once during app initialisation so auth failures are caught before the
 * first real email rather than silently failing later.
 * Throws if credentials are missing or nodemailer.verify() rejects.
 */
async function verifyTransporter() {
    const t = getTransporter();
    if (!t) {
        throw new Error('Email service not configured: set SMTP_HOST/SMTP_USER/SMTP_PASS or GMAIL_USER/GMAIL_APP_PASSWORD');
    }
    await t.verify();
    logger.info('Email transporter verified successfully');
}

// Fallback admin email (will be overridden by settings)
const fallbackAdminEmail = process.env.CONTACT_ADMIN_EMAIL || process.env.SMTP_USER || process.env.GMAIL_USER || 'support@qualitickzm.com';

// The address that appears in the From header of every outgoing email
const MAIL_FROM_ADDRESS = process.env.SMTP_FROM || process.env.SMTP_USER || process.env.GMAIL_USER || 'support@qualitickzm.com';
const MAIL_FROM = `"Qualitick Collections" <${MAIL_FROM_ADDRESS}>`;

/**
 * Escape user-supplied strings before interpolating into HTML.
 * Must be applied to every value that originates outside the application
 * (customer names, emails, messages, product names, addresses, etc.).
 */
function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

/**
 * Get subject label from subject code
 */
function getSubjectLabel(subject) {
    const subjects = {
        'product-inquiry': 'Product Inquiry',
        'order-support': 'Order Support',
        'shipping': 'Shipping & Delivery',
        'returns': 'Returns & Exchanges',
        'business': 'Business Partnership',
        'other': 'Other'
    };
    return subjects[subject] || 'General Inquiry';
}

/**
 * Send contact form notification to admin
 * @param {Object} submission - Contact submission data
 * @returns {Promise<Object>} - Email send result
 */
async function sendContactNotificationToAdmin(submission) {
    const transporter = getTransporter();
    if (!transporter) {
        logger.warn('Cannot send email: Transporter not configured');
        return { success: false, error: 'Email service not configured' };
    }

    // Check if contact submission notifications are enabled
    try {
        const shouldSend = await settingsService.shouldSendNotification('contactSubmission');
        if (!shouldSend) {
            logger.debug('Contact submission notifications are disabled in settings');
            return { success: false, error: 'Contact submission notifications are disabled' };
        }
    } catch (settingsError) {
        logger.warn({ settingsErrorMessage: settingsError.message }, 'Error checking notification settings, proceeding with send');
        // Continue with send if settings check fails (fail open)
    }

    try {
        // Get notification email from settings
        const notificationEmail = await settingsService.getNotificationEmail();
        const subjectLabel = getSubjectLabel(submission.subject);
        const formattedDate = new Date(submission.createdAt || Date.now()).toLocaleString('en-US', {
            dateStyle: 'long',
            timeStyle: 'short'
        });

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #FFD700; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                    .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
                    .field { margin: 15px 0; }
                    .label { font-weight: bold; color: #555; }
                    .value { margin-top: 5px; padding: 10px; background: white; border-radius: 4px; }
                    .message-box { padding: 15px; background: white; border-left: 4px solid #FFD700; margin: 15px 0; }
                    .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #777; text-align: center; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2 style="margin: 0; color: #333;">New Contact Form Submission</h2>
                    </div>
                    <div class="content">
                        <div class="field">
                            <div class="label">Subject:</div>
                            <div class="value">${subjectLabel}</div>
                        </div>
                        <div class="field">
                            <div class="label">Name:</div>
                            <div class="value">${esc(submission.name)}</div>
                        </div>
                        <div class="field">
                            <div class="label">Email:</div>
                            <div class="value"><a href="mailto:${esc(submission.email)}">${esc(submission.email)}</a></div>
                        </div>
                        ${submission.phone ? `
                        <div class="field">
                            <div class="label">Phone:</div>
                            <div class="value">${esc(submission.phone)}</div>
                        </div>
                        ` : ''}
                        <div class="field">
                            <div class="label">Message:</div>
                            <div class="message-box">${esc(submission.message).replace(/\n/g, '<br>')}</div>
                        </div>
                        <div class="field">
                            <div class="label">Submitted:</div>
                            <div class="value">${formattedDate}</div>
                        </div>
                        <div class="footer">
                            <p>This is an automated notification from Qualitick Collections contact form.</p>
                            <p>Please respond to the customer at: <a href="mailto:${esc(submission.email)}">${esc(submission.email)}</a></p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        const mailOptions = {
            from: MAIL_FROM,
            to: notificationEmail,
            subject: `New Contact Form Submission - ${subjectLabel}`,
            html: htmlContent,
            replyTo: submission.email
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info({ messageId: info.messageId }, 'Admin notification sent');
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error({ err: error }, 'Error sending admin notification');
        return { success: false, error: error.message };
    }
}

/**
 * Send confirmation email to user
 * @param {Object} submission - Contact submission data
 * @returns {Promise<Object>} - Email send result
 */
async function sendContactConfirmationToUser(submission) {
    const transporter = getTransporter();
    if (!transporter) {
        logger.warn('Cannot send email: Transporter not configured');
        return { success: false, error: 'Email service not configured' };
    }

    try {
        const subjectLabel = getSubjectLabel(submission.subject);
        const formattedDate = new Date(submission.createdAt || Date.now()).toLocaleString('en-US', {
            dateStyle: 'long',
            timeStyle: 'short'
        });

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #FFD700; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                    .message { background: white; padding: 20px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #FFD700; }
                    .info-box { background: white; padding: 15px; border-radius: 4px; margin: 15px 0; }
                    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #777; text-align: center; }
                    .btn { display: inline-block; padding: 12px 24px; background: #FFD700; color: #333; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1 style="margin: 0; color: #333;">Thank You for Contacting Us!</h1>
                    </div>
                    <div class="content">
                        <p>Dear ${esc(submission.name)},</p>
                        <p>Thank you for reaching out to Qualitick Collections. We have received your message and our team will get back to you as soon as possible.</p>
                        
                        <div class="info-box">
                            <strong>Your Inquiry Details:</strong><br>
                            <strong>Subject:</strong> ${subjectLabel}<br>
                            <strong>Submitted:</strong> ${formattedDate}
                        </div>
                        
                        <div class="message">
                            <strong>Your Message:</strong><br>
                            ${esc(submission.message).replace(/\n/g, '<br>')}
                        </div>
                        
                        <p>We typically respond within 24-48 hours during business days (Monday-Friday, 9AM-6PM).</p>
                        
                        <p>If you have any urgent inquiries, please feel free to contact us directly via WhatsApp at <a href="https://wa.me/260975587617">+260 975 587 617</a>.</p>
                        
                        <div style="text-align: center;">
                            <a href="https://qualitick-collections.com" class="btn">Visit Our Website</a>
                        </div>
                        
                        <div class="footer">
                            <p><strong>Qualitick Collections</strong></p>
                            <p>Premium Luxury Watches</p>
                            <p>This is an automated confirmation email. Please do not reply to this email.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        const mailOptions = {
            from: MAIL_FROM,
            to: submission.email,
            subject: 'Thank You for Contacting Qualitick Collections',
            html: htmlContent
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info({ messageId: info.messageId }, 'User confirmation sent');
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error({ err: error }, 'Error sending user confirmation');
        return { success: false, error: error.message };
    }
}

/**
 * Send invoice email to customer
 * @param {Object} order - Order object
 * @param {Buffer} pdfBuffer - PDF invoice buffer
 * @param {Object} options - Additional options (cc, bcc, etc.)
 * @returns {Promise<Object>} - Email send result
 */
async function sendInvoiceEmail(order, pdfBuffer, options = {}) {
    const transporter = getTransporter();
    if (!transporter) {
        logger.warn('Cannot send email: Transporter not configured');
        return { success: false, error: 'Email service not configured' };
    }

    try {
        const orderDate = new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #FFD700; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                    .order-info { background: white; padding: 20px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #FFD700; }
                    .info-row { display: flex; justify-content: space-between; margin: 10px 0; padding: 8px 0; border-bottom: 1px solid #eee; }
                    .info-label { font-weight: bold; color: #555; }
                    .info-value { color: #333; }
                    .items-summary { background: white; padding: 15px; border-radius: 4px; margin: 15px 0; }
                    .item-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
                    .total-row { display: flex; justify-content: space-between; padding: 15px 0; margin-top: 10px; border-top: 2px solid #FFD700; font-size: 18px; font-weight: bold; }
                    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #777; text-align: center; }
                    .btn { display: inline-block; padding: 12px 24px; background: #FFD700; color: #333; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1 style="margin: 0; color: #333;">Your Order Invoice</h1>
                    </div>
                    <div class="content">
                        <p>Dear ${esc(order.customer.name)},</p>
                        <p>Thank you for your order with Qualitick Collections! Please find your invoice attached to this email.</p>

                        <div class="order-info">
                            <h3 style="margin-top: 0; color: #333;">Order Details</h3>
                            <div class="info-row">
                                <span class="info-label">Order Number:</span>
                                <span class="info-value">${esc(order.orderNumber)}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Order Date:</span>
                                <span class="info-value">${orderDate}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Order Status:</span>
                                <span class="info-value">${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Payment Status:</span>
                                <span class="info-value">${order.paymentStatus.charAt(0).toUpperCase() + order.paymentStatus.slice(1)}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Payment Method:</span>
                                <span class="info-value">${formatPaymentMethod(order.paymentMethod)}</span>
                            </div>
                        </div>
                        
                        <div class="items-summary">
                            <h3 style="margin-top: 0; color: #333;">Order Summary</h3>
                            ${order.items.map(item => `
                                <div class="item-row">
                                    <span>${esc(item.name)} x ${item.quantity}</span>
                                    <span>K${formatCurrency(item.price * item.quantity)}</span>
                                </div>
                            `).join('')}
                            <div class="info-row">
                                <span class="info-label">Subtotal:</span>
                                <span class="info-value">K${formatCurrency(order.totals.subtotal || 0)}</span>
                            </div>
                            ${order.totals.discount > 0 ? `
                            <div class="info-row">
                                <span class="info-label">Discount:</span>
                                <span class="info-value">-K${formatCurrency(order.totals.discount)}</span>
                            </div>
                            ` : ''}
                            ${order.totals.delivery > 0 ? `
                            <div class="info-row">
                                <span class="info-label">Delivery Fee:</span>
                                <span class="info-value">K${formatCurrency(order.totals.delivery)}</span>
                            </div>
                            ` : ''}
                            <div class="total-row">
                                <span>Total:</span>
                                <span>K${formatCurrency(order.totals.total || 0)}</span>
                            </div>
                        </div>

                        ${order.shipping && !order.shipping.pickup ? `
                        <div class="order-info">
                            <h3 style="margin-top: 0; color: #333;">Shipping Address</h3>
                            <p style="margin: 5px 0;">${esc(order.shipping.address)}</p>
                            <p style="margin: 5px 0;">${esc(order.shipping.city)}, ${esc(order.shipping.province)}</p>
                        </div>
                        ` : `
                        <div class="order-info">
                            <h3 style="margin-top: 0; color: #333;">Delivery Method</h3>
                            <p style="margin: 5px 0;">Store Pickup</p>
                        </div>
                        `}

                        <p>Your invoice is attached as a PDF document. Please keep this for your records.</p>
                        
                        <p>If you have any questions about your order, please don't hesitate to contact us.</p>
                        
                        <div style="text-align: center;">
                            <a href="https://qualitick-collections.com" class="btn">Visit Our Website</a>
                        </div>
                        
                        <div class="footer">
                            <p><strong>Qualitick Collections</strong></p>
                            <p>Premium Luxury Watches</p>
                            <p>Email: info@qualitickcollections.com</p>
                            <p>This is an automated email. Please do not reply to this email.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        const mailOptions = {
            from: MAIL_FROM,
            to: order.customer.email,
            cc: options.cc || undefined,
            bcc: options.bcc || undefined,
            subject: `Invoice for Order ${order.orderNumber} - Qualitick Collections`,
            html: htmlContent,
            attachments: [
                {
                    filename: `Invoice-${order.orderNumber}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        };

        const info = await transporter.sendMail(mailOptions);
        // Do not log recipient email addresses (PII).
        logger.info({ orderNumber: order.orderNumber, messageId: info.messageId }, 'Invoice email sent');
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error({ err: error }, 'Error sending invoice email');
        return { success: false, error: error.message };
    }
}

/**
 * Format currency amount
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
    return parseFloat(amount || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/**
 * Format payment method
 * @param {string} method - Payment method
 * @returns {string} Formatted payment method
 */
function formatPaymentMethod(method) {
    const methods = {
        'mobile_money': 'Mobile Money',
        'bank_transfer': 'Bank Transfer',
        'card': 'Credit/Debit Card',
        'cash_on_delivery': 'Cash on Delivery'
    };
    return methods[method] || method || 'N/A';
}

/**
 * Send new order notification to admin
 * @param {Object} order - Order object
 * @returns {Promise<Object>} - Email send result
 */
async function sendOrderNotificationToAdmin(order) {
    const transporter = getTransporter();
    if (!transporter) {
        logger.warn('Cannot send email: Transporter not configured');
        return { success: false, error: 'Email service not configured' };
    }

    // Check if new order notifications are enabled
    try {
        const shouldSend = await settingsService.shouldSendNotification('newOrder');
        if (!shouldSend) {
            logger.debug('New order notifications are disabled in settings');
            return { success: false, error: 'New order notifications are disabled' };
        }
    } catch (settingsError) {
        logger.warn({ settingsErrorMessage: settingsError.message }, 'Error checking notification settings, proceeding with send');
        // Continue with send if settings check fails (fail open)
    }

    try {
        // Get notification email from settings
        const notificationEmail = await settingsService.getNotificationEmail();
        
        const orderDate = new Date(order.createdAt || Date.now()).toLocaleString('en-US', {
            dateStyle: 'long',
            timeStyle: 'short'
        });

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: #FFD700; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                    .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
                    .order-info { background: white; padding: 20px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #28a745; }
                    .info-row { display: flex; justify-content: space-between; margin: 10px 0; padding: 8px 0; border-bottom: 1px solid #eee; }
                    .info-label { font-weight: bold; color: #555; }
                    .info-value { color: #333; }
                    .items-list { background: white; padding: 15px; border-radius: 4px; margin: 15px 0; }
                    .item-row { padding: 8px 0; border-bottom: 1px solid #eee; }
                    .total-row { display: flex; justify-content: space-between; padding: 15px 0; margin-top: 10px; border-top: 2px solid #28a745; font-size: 18px; font-weight: bold; }
                    .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #777; text-align: center; }
                    .btn { display: inline-block; padding: 12px 24px; background: #28a745; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2 style="margin: 0; color: #333;">New Order Received</h2>
                    </div>
                    <div class="content">
                        <p>A new order has been placed on your store.</p>
                        
                        <div class="order-info">
                            <h3 style="margin-top: 0; color: #333;">Order Details</h3>
                            <div class="info-row">
                                <span class="info-label">Order Number:</span>
                                <span class="info-value">${esc(order.orderNumber)}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Order Date:</span>
                                <span class="info-value">${orderDate}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Customer:</span>
                                <span class="info-value">${esc(order.customer.name)}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Customer Email:</span>
                                <span class="info-value"><a href="mailto:${esc(order.customer.email)}">${esc(order.customer.email)}</a></span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Customer Phone:</span>
                                <span class="info-value">${order.customer.phone ? esc(order.customer.phone) : 'N/A'}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Payment Method:</span>
                                <span class="info-value">${formatPaymentMethod(order.paymentMethod)}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Order Status:</span>
                                <span class="info-value">${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Payment Status:</span>
                                <span class="info-value">${order.paymentStatus.charAt(0).toUpperCase() + order.paymentStatus.slice(1)}</span>
                            </div>
                        </div>
                        
                        <div class="items-list">
                            <h3 style="margin-top: 0; color: #333;">Order Items</h3>
                            ${order.items.map(item => `
                                <div class="item-row">
                                    <strong>${esc(item.name)}</strong> x ${item.quantity} - K${formatCurrency(item.price * item.quantity)}
                                </div>
                            `).join('')}
                            <div class="info-row">
                                <span class="info-label">Subtotal:</span>
                                <span class="info-value">K${formatCurrency(order.totals.subtotal || 0)}</span>
                            </div>
                            ${order.totals.discount > 0 ? `
                            <div class="info-row">
                                <span class="info-label">Discount:</span>
                                <span class="info-value">-K${formatCurrency(order.totals.discount)}</span>
                            </div>
                            ` : ''}
                            ${order.totals.delivery > 0 ? `
                            <div class="info-row">
                                <span class="info-label">Delivery Fee:</span>
                                <span class="info-value">K${formatCurrency(order.totals.delivery)}</span>
                            </div>
                            ` : ''}
                            <div class="total-row">
                                <span>Total:</span>
                                <span>K${formatCurrency(order.totals.total || 0)}</span>
                            </div>
                        </div>
                        
                        ${order.shipping && !order.shipping.pickup ? `
                        <div class="order-info">
                            <h3 style="margin-top: 0; color: #333;">Shipping Address</h3>
                            <p style="margin: 5px 0;">${esc(order.shipping.address)}</p>
                            <p style="margin: 5px 0;">${esc(order.shipping.city)}, ${esc(order.shipping.province)}</p>
                        </div>
                        ` : `
                        <div class="order-info">
                            <h3 style="margin-top: 0; color: #333;">Delivery Method</h3>
                            <p style="margin: 5px 0;">Store Pickup</p>
                        </div>
                        `}

                        <div style="text-align: center;">
                            <a href="${process.env.SITE_URL || 'https://qualitick-collections.com'}/admin/orders" class="btn">View Order in Admin Panel</a>
                        </div>
                        
                        <div class="footer">
                            <p>This is an automated notification from Qualitick Collections.</p>
                            <p>Order notifications can be managed in Admin Settings.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        const mailOptions = {
            from: MAIL_FROM,
            to: notificationEmail,
            subject: `New Order #${order.orderNumber} - K${formatCurrency(order.totals.total || 0)}`,
            html: htmlContent
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info({ messageId: info.messageId }, 'New order notification sent');
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error({ err: error }, 'Error sending new order notification');
        return { success: false, error: error.message };
    }
}

/**
 * Send low stock notification to admin
 * @param {Object} product - Product object
 * @returns {Promise<Object>} - Email send result
 */
async function sendLowStockNotificationToAdmin(product) {
    const transporter = getTransporter();
    if (!transporter) {
        logger.warn('Cannot send email: Transporter not configured');
        return { success: false, error: 'Email service not configured' };
    }

    // Check if low stock notifications are enabled
    try {
        const shouldSend = await settingsService.shouldSendNotification('lowStock');
        if (!shouldSend) {
            logger.debug('Low stock notifications are disabled in settings');
            return { success: false, error: 'Low stock notifications are disabled' };
        }
    } catch (settingsError) {
        logger.warn({ settingsErrorMessage: settingsError.message }, 'Error checking notification settings, proceeding with send');
        // Continue with send if settings check fails (fail open)
    }

    try {
        // Get notification email from settings
        const notificationEmail = await settingsService.getNotificationEmail();
        
        const threshold = product.lowStockThreshold || 5;
        const isCritical = product.stock === 0;

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: ${isCritical ? '#dc3545' : '#ff8c00'}; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; color: white; }
                    .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
                    .alert-box { background: white; padding: 20px; border-radius: 4px; margin: 20px 0; border-left: 4px solid ${isCritical ? '#dc3545' : '#ff8c00'}; }
                    .info-row { display: flex; justify-content: space-between; margin: 10px 0; padding: 8px 0; border-bottom: 1px solid #eee; }
                    .info-label { font-weight: bold; color: #555; }
                    .info-value { color: #333; }
                    .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #777; text-align: center; }
                    .btn { display: inline-block; padding: 12px 24px; background: ${isCritical ? '#dc3545' : '#ff8c00'}; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2 style="margin: 0;">${isCritical ? 'Out of Stock Alert' : 'Low Stock Alert'}</h2>
                    </div>
                    <div class="content">
                        <p>A product in your inventory ${isCritical ? 'is out of stock' : 'has low stock'}.</p>
                        
                        <div class="alert-box">
                            <h3 style="margin-top: 0; color: #333;">Product Details</h3>
                            <div class="info-row">
                                <span class="info-label">Product:</span>
                                <span class="info-value"><strong>${esc(product.brand)} ${esc(product.model)}</strong></span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">SKU:</span>
                                <span class="info-value">${esc(product.sku)}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Current Stock:</span>
                                <span class="info-value" style="color: ${isCritical ? '#dc3545' : '#ff8c00'}; font-weight: bold;">${product.stock} units</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Low Stock Threshold:</span>
                                <span class="info-value">${threshold} units</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Price:</span>
                                <span class="info-value">K${formatCurrency(product.price || 0)}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Status:</span>
                                <span class="info-value">${product.status || 'active'}</span>
                            </div>
                        </div>
                        
                        <div style="text-align: center;">
                            <a href="${process.env.SITE_URL || 'https://qualitick-collections.com'}/admin/inventory" class="btn">Manage Inventory</a>
                        </div>
                        
                        <div class="footer">
                            <p>This is an automated notification from Qualitick Collections.</p>
                            <p>Low stock notifications can be managed in Admin Settings.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        const mailOptions = {
            from: MAIL_FROM,
            to: notificationEmail,
            subject: `${isCritical ? 'Out of Stock' : 'Low Stock'} Alert: ${product.brand} ${product.model} (${product.sku})`,
            html: htmlContent
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info({ messageId: info.messageId }, 'Low stock notification sent');
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error({ err: error }, 'Error sending low stock notification');
        return { success: false, error: error.message };
    }
}

/**
 * Send payment notification to admin
 * @param {Object} payment - Payment object
 * @param {Object} order - Optional order object for context
 * @returns {Promise<Object>} - Email send result
 */
async function sendPaymentNotificationToAdmin(payment, order = null) {
    const transporter = getTransporter();
    if (!transporter) {
        logger.warn('Cannot send email: Transporter not configured');
        return { success: false, error: 'Email service not configured' };
    }

    // Check if payment notifications are enabled
    try {
        const shouldSend = await settingsService.shouldSendNotification('payment');
        if (!shouldSend) {
            logger.debug('Payment notifications are disabled in settings');
            return { success: false, error: 'Payment notifications are disabled' };
        }
    } catch (settingsError) {
        logger.warn({ settingsErrorMessage: settingsError.message }, 'Error checking notification settings, proceeding with send');
        // Continue with send if settings check fails (fail open)
    }

    try {
        // Get notification email from settings
        const notificationEmail = await settingsService.getNotificationEmail();
        
        const paymentDate = new Date(payment.createdAt || Date.now()).toLocaleString('en-US', {
            dateStyle: 'long',
            timeStyle: 'short'
        });
        
        const isCompleted = payment.status === 'completed' || payment.status === 'paid';
        const isFailed = payment.status === 'failed';

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: ${isCompleted ? '#28a745' : isFailed ? '#dc3545' : '#ffc107'}; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; color: white; }
                    .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
                    .payment-info { background: white; padding: 20px; border-radius: 4px; margin: 20px 0; border-left: 4px solid ${isCompleted ? '#28a745' : isFailed ? '#dc3545' : '#ffc107'}; }
                    .info-row { display: flex; justify-content: space-between; margin: 10px 0; padding: 8px 0; border-bottom: 1px solid #eee; }
                    .info-label { font-weight: bold; color: #555; }
                    .info-value { color: #333; }
                    .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #777; text-align: center; }
                    .btn { display: inline-block; padding: 12px 24px; background: ${isCompleted ? '#28a745' : isFailed ? '#dc3545' : '#ffc107'}; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2 style="margin: 0;">Payment ${isCompleted ? 'Completed' : isFailed ? 'Failed' : 'Update'}</h2>
                    </div>
                    <div class="content">
                        <p>A payment has been ${isCompleted ? 'successfully completed' : isFailed ? 'failed' : 'updated'}.</p>
                        
                        <div class="payment-info">
                            <h3 style="margin-top: 0; color: #333;">Payment Details</h3>
                            <div class="info-row">
                                <span class="info-label">Order Number:</span>
                                <span class="info-value">${esc(payment.orderNumber)}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Payment Status:</span>
                                <span class="info-value" style="color: ${isCompleted ? '#28a745' : isFailed ? '#dc3545' : '#ffc107'}; font-weight: bold;">${payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Amount:</span>
                                <span class="info-value"><strong>K${formatCurrency(payment.amount || 0)}</strong></span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Currency:</span>
                                <span class="info-value">${payment.currency || 'ZMW'}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Payment Method:</span>
                                <span class="info-value">${formatPaymentMethod(payment.paymentMethod)}</span>
                            </div>
                            ${payment.transactionId || payment.lencoTransactionId ? `
                            <div class="info-row">
                                <span class="info-label">Transaction ID:</span>
                                <span class="info-value">${esc(payment.transactionId || payment.lencoTransactionId)}</span>
                            </div>
                            ` : ''}
                            <div class="info-row">
                                <span class="info-label">Payment Date:</span>
                                <span class="info-value">${paymentDate}</span>
                            </div>
                            ${payment.customerInfo ? `
                            <div class="info-row">
                                <span class="info-label">Customer:</span>
                                <span class="info-value">${esc(payment.customerInfo.name)}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Customer Email:</span>
                                <span class="info-value"><a href="mailto:${esc(payment.customerInfo.email)}">${esc(payment.customerInfo.email)}</a></span>
                            </div>
                            ` : ''}
                        </div>
                        
                        <div style="text-align: center;">
                            <a href="${process.env.SITE_URL || 'https://qualitick-collections.com'}/admin/orders" class="btn">View Order in Admin Panel</a>
                        </div>
                        
                        <div class="footer">
                            <p>This is an automated notification from Qualitick Collections.</p>
                            <p>Payment notifications can be managed in Admin Settings.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        const mailOptions = {
            from: MAIL_FROM,
            to: notificationEmail,
            subject: `Payment ${isCompleted ? 'Completed' : isFailed ? 'Failed' : 'Update'} - Order #${payment.orderNumber} - K${formatCurrency(payment.amount || 0)}`,
            html: htmlContent
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info({ messageId: info.messageId }, 'Payment notification sent');
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error({ err: error }, 'Error sending payment notification');
        return { success: false, error: error.message };
    }
}

/**
 * Send email verification link to a new storefront account.
 * @param {{ to: string, name: string, verifyUrl: string }} params
 */
async function sendCustomerEmailVerification({ to, name, verifyUrl }) {
    const transporter = getTransporter();
    if (!transporter) {
        logger.warn('Cannot send verification email: transporter not configured');
        return { success: false, error: 'Email service not configured' };
    }

    const safeName = esc(name);
    const safeUrl = esc(verifyUrl);

    const html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #222;">
            <p>Hi ${safeName},</p>
            <p>Thanks for creating an account with Qualitick Collections. Please verify your email to unlock layby at checkout (when logged in).</p>
            <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:4px;">Verify email</a></p>
            <p>Or copy this link into your browser:<br><span style="word-break:break-all;">${safeUrl}</span></p>
            <p>If you did not create an account, you can ignore this message.</p>
        </body>
        </html>
    `;

    try {
        const info = await transporter.sendMail({
            from: MAIL_FROM,
            to,
            subject: 'Verify your email — Qualitick Collections',
            html
        });
        logger.info({ messageId: info.messageId }, 'Customer verification email sent');
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error({ err: error }, 'Error sending customer verification email');
        return { success: false, error: error.message };
    }
}

/**
 * @param {{ to: string, name: string, resetUrl: string }} params
 */
async function sendCustomerPasswordResetEmail({ to, name, resetUrl }) {
    const transporter = getTransporter();
    if (!transporter) {
        logger.warn('Cannot send password reset email: transporter not configured');
        return { success: false, error: 'Email service not configured' };
    }

    const safeName = esc(name);
    const safeUrl = esc(resetUrl);
    const expiryNote = `This link expires in ${parseInt(process.env.PASSWORD_RESET_EXPIRY_MINUTES || '60', 10)} minutes.`;

    const html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: Arial, sans-serif; line-height: 1.5; color: #222;">
            <p>Hi ${safeName},</p>
            <p>We received a request to reset your Qualitick Collections account password.</p>
            <p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:4px;">Reset password</a></p>
            <p>Or copy this link into your browser:<br><span style="word-break:break-all;">${safeUrl}</span></p>
            <p>${esc(expiryNote)}</p>
            <p>If you did not request this, you can ignore this email. Your password will not change.</p>
        </body>
        </html>
    `;

    try {
        const info = await transporter.sendMail({
            from: MAIL_FROM,
            to,
            subject: 'Reset your password — Qualitick Collections',
            html
        });
        logger.info({ messageId: info.messageId }, 'Password reset email sent');
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error({ err: error }, 'Error sending password reset email');
        return { success: false, error: error.message };
    }
}

/**
 * Send order confirmation email to customer when admin confirms their order.
 * @param {Object} order - Order instance (Sequelize model or plain object)
 * @returns {Promise<Object>} - { success, messageId } or { success: false, error }
 */
async function sendOrderConfirmationEmail(order) {
    const transporter = getTransporter();
    if (!transporter) {
        logger.warn('Cannot send order confirmation email: transporter not configured');
        return { success: false, error: 'Email service not configured' };
    }

    try {
        const customerName = esc(order.customer?.name || 'Valued Customer');
        const orderNumber  = esc(order.orderNumber || '');
        const orderDate    = new Date(order.createdAt || Date.now()).toLocaleString('en-US', {
            dateStyle: 'long',
            timeStyle: 'short'
        });

        const items = Array.isArray(order.items) ? order.items : [];
        const totals = order.totals || {};

        const itemRows = items.map(item => `
            <tr>
                <td style="padding: 10px 8px; border-bottom: 1px solid #eee;">${esc(item.name)}</td>
                <td style="padding: 10px 8px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
                <td style="padding: 10px 8px; border-bottom: 1px solid #eee; text-align: right;">K${formatCurrency(item.price * item.quantity)}</td>
            </tr>
        `).join('');

        const deliveryBlock = order.shipping && !order.shipping.pickup
            ? `<div class="section">
                   <h3 style="margin: 0 0 12px; color: #333; font-size: 15px;">Delivery Address</h3>
                   <p style="margin: 4px 0;">${esc(order.shipping.address)}</p>
                   <p style="margin: 4px 0;">${esc(order.shipping.city)}${order.shipping.province ? ', ' + esc(order.shipping.province) : ''}</p>
               </div>`
            : `<div class="section">
                   <h3 style="margin: 0 0 12px; color: #333; font-size: 15px;">Delivery Method</h3>
                   <p style="margin: 4px 0;">Store Pickup</p>
               </div>`;

        const discountRow = totals.discount > 0
            ? `<tr><td style="padding: 6px 8px; color: #555;">Discount</td><td style="padding: 6px 8px; text-align: right;">-K${formatCurrency(totals.discount)}</td></tr>`
            : '';

        const deliveryRow = totals.delivery > 0
            ? `<tr><td style="padding: 6px 8px; color: #555;">Delivery Fee</td><td style="padding: 6px 8px; text-align: right;">K${formatCurrency(totals.delivery)}</td></tr>`
            : '';

        const html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    body { margin: 0; padding: 0; background: #f4f4f4; font-family: Arial, sans-serif; color: #333; }
                    .wrapper { max-width: 600px; margin: 30px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
                    .header { background: #FFD700; padding: 36px 30px; text-align: center; }
                    .header h1 { margin: 0; font-size: 26px; color: #222; letter-spacing: 0.5px; }
                    .header p { margin: 6px 0 0; color: #555; font-size: 14px; }
                    .body { padding: 32px 30px; }
                    .section { background: #fafafa; border-left: 4px solid #FFD700; border-radius: 4px; padding: 18px 20px; margin: 20px 0; }
                    .items-table { width: 100%; border-collapse: collapse; margin: 0; }
                    .items-table th { background: #FFD700; color: #222; padding: 10px 8px; text-align: left; font-size: 13px; }
                    .items-table th:last-child { text-align: right; }
                    .items-table th:nth-child(2) { text-align: center; }
                    .totals-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
                    .total-final td { font-size: 16px; font-weight: bold; padding: 12px 8px !important; border-top: 2px solid #FFD700; }
                    .cta { display: inline-block; margin-top: 24px; padding: 12px 28px; background: #FFD700; color: #222; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 14px; }
                    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #999; text-align: center; line-height: 1.8; }
                </style>
            </head>
            <body>
                <div class="wrapper">
                    <div class="header">
                        <h1>Order Confirmed</h1>
                        <p>Qualitick Collections</p>
                    </div>
                    <div class="body">
                        <p>Dear ${customerName},</p>
                        <p>
                            Thank you for your order! We've successfully received and confirmed it, and our team is already
                            getting everything ready for you.
                        </p>
                        <p>
                            You'll receive another update as soon as your order has been shipped. If you have any questions
                            in the meantime, feel free to reach out — we're here to help!
                        </p>

                        <div class="section">
                            <h3 style="margin: 0 0 12px; color: #333; font-size: 15px;">Order Details</h3>
                            <table style="width: 100%; font-size: 14px;">
                                <tr>
                                    <td style="padding: 4px 0; color: #555; width: 45%;">Order Number</td>
                                    <td style="padding: 4px 0; font-weight: bold;">${orderNumber}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 4px 0; color: #555;">Order Date</td>
                                    <td style="padding: 4px 0;">${orderDate}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 4px 0; color: #555;">Payment Method</td>
                                    <td style="padding: 4px 0;">${esc(formatPaymentMethod(order.paymentMethod))}</td>
                                </tr>
                            </table>
                        </div>

                        <div class="section">
                            <h3 style="margin: 0 0 14px; color: #333; font-size: 15px;">Items Ordered</h3>
                            <table class="items-table">
                                <thead>
                                    <tr>
                                        <th>Product</th>
                                        <th>Qty</th>
                                        <th>Price</th>
                                    </tr>
                                </thead>
                                <tbody>${itemRows}</tbody>
                            </table>
                            <table class="totals-table" style="margin-top: 10px; font-size: 14px;">
                                <tr><td style="padding: 6px 8px; color: #555;">Subtotal</td><td style="padding: 6px 8px; text-align: right;">K${formatCurrency(totals.subtotal || 0)}</td></tr>
                                ${discountRow}
                                ${deliveryRow}
                                <tr class="total-final"><td style="padding: 6px 8px;">Total</td><td style="padding: 6px 8px; text-align: right;">K${formatCurrency(totals.total || 0)}</td></tr>
                            </table>
                        </div>

                        ${deliveryBlock}

                        <div style="text-align: center;">
                            <a href="${process.env.APP_PUBLIC_URL || 'https://qualitick-collections.com'}/account/orders" class="cta">View My Orders</a>
                        </div>

                        <div class="footer">
                            <p><strong>Qualitick Collections</strong> — Premium Luxury Watches</p>
                            <p>Questions? Contact us at <a href="mailto:support@qualitickzm.com" style="color: #999;">support@qualitickzm.com</a></p>
                            <p>This is an automated message. Please do not reply directly to this email.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        const info = await transporter.sendMail({
            from: MAIL_FROM,
            to: order.customer.email,
            subject: `Your order ${orderNumber} has been confirmed — Qualitick Collections`,
            html
        });

        logger.info({ orderNumber: order.orderNumber, messageId: info.messageId }, 'Order confirmation email sent');
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error({ err: error, orderNumber: order.orderNumber }, 'Error sending order confirmation email');
        return { success: false, error: error.message };
    }
}

/**
 * Send dispatch / shipping notification to customer.
 * @param {{ order: object, courier: string, trackingNumber: string, note: string }} params
 */
async function sendDispatchEmail({ order, courier, trackingNumber, note }) {
    const transporter = getTransporter();
    if (!transporter) {
        logger.warn('Cannot send dispatch email: transporter not configured');
        return { success: false, error: 'Email service not configured' };
    }

    const customerName = esc(order.customer?.name || 'Valued Customer');
    const orderNumber  = esc(order.orderNumber || '');
    const safeCourier  = esc(courier || 'our delivery partner');
    const safeTracking = esc(trackingNumber || '');
    const noteHtml     = note
        ? `<p style="margin:16px 0 0;">${esc(note).replace(/\n/g, '<br>')}</p>`
        : '';

    const trackingBlock = safeTracking
        ? `<tr><td style="padding:6px 8px;color:#555;">Tracking Number</td><td style="padding:6px 8px;font-weight:bold;">${safeTracking}</td></tr>`
        : '';

    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body { margin:0; padding:0; background:#f4f4f4; font-family:Arial,sans-serif; color:#333; }
                .wrapper { max-width:600px; margin:30px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
                .header { background:#FFD700; padding:36px 30px; text-align:center; }
                .header h1 { margin:0; font-size:26px; color:#222; }
                .header p { margin:6px 0 0; color:#555; font-size:14px; }
                .body { padding:32px 30px; }
                .section { background:#fafafa; border-left:4px solid #FFD700; border-radius:4px; padding:18px 20px; margin:20px 0; }
                .info-table { width:100%; border-collapse:collapse; }
                .footer { margin-top:30px; padding-top:20px; border-top:1px solid #eee; font-size:12px; color:#999; text-align:center; line-height:1.8; }
            </style>
        </head>
        <body>
            <div class="wrapper">
                <div class="header">
                    <h1>Your Order Is On Its Way</h1>
                    <p>Qualitick Collections</p>
                </div>
                <div class="body">
                    <p>Dear ${customerName},</p>
                    <p>Great news! Your order <strong>#${orderNumber}</strong> has been dispatched and is now on its way to you.</p>

                    <div class="section">
                        <h3 style="margin:0 0 12px;color:#333;font-size:15px;">Shipping Details</h3>
                        <table class="info-table">
                            <tr><td style="padding:6px 8px;color:#555;">Shipping Company</td><td style="padding:6px 8px;font-weight:bold;">${safeCourier}</td></tr>
                            ${trackingBlock}
                        </table>
                        ${noteHtml}
                    </div>

                    <p>If you have any questions about your delivery, feel free to contact us.</p>
                    <p>Thank you for shopping with Qualitick Collections!</p>
                    <div class="footer">
                        &copy; ${new Date().getFullYear()} Qualitick Collections. All rights reserved.
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;

    try {
        const to = order.customer?.email;
        if (!to) return { success: false, error: 'No customer email on order' };
        const info = await transporter.sendMail({
            from: MAIL_FROM,
            to,
            subject: `Your order #${order.orderNumber} has been dispatched — Qualitick Collections`,
            html
        });
        logger.info({ orderNumber: order.orderNumber, messageId: info.messageId }, 'Dispatch email sent');
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error({ err: error, orderNumber: order.orderNumber }, 'Error sending dispatch email');
        return { success: false, error: error.message };
    }
}

/**
 * Welcome email for new newsletter subscribers (transactional).
 * Call only when newsletter.service.subscribe() returned sendWelcome: true (new row, recovery
 * create, or reactivation after the per-email cooldown) — not for duplicate active signups
 * or per-email throttle. Does not block HTTP; invoke fire-and-forget from the controller.
 * @param {{ email: string, unsubscribeToken?: string }} params
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function sendNewsletterWelcomeEmail(params) {
    const transporter = getTransporter();
    if (!transporter) {
        logger.warn('Cannot send newsletter welcome: transporter not configured');
        return { success: false, error: 'Email service not configured' };
    }

    const to = typeof params?.email === 'string' ? params.email.trim() : '';
    if (!to) {
        return { success: false, error: 'Missing recipient' };
    }

    const siteOrigin = String(
        process.env.SITE_URL || process.env.APP_PUBLIC_URL || 'https://qualitick-collections.com'
    ).replace(/\/$/, '');
    const token =
        typeof params.unsubscribeToken === 'string' && /^[a-f0-9]{64}$/i.test(params.unsubscribeToken.trim())
            ? params.unsubscribeToken.trim().toLowerCase()
            : null;
    const unsubUrl = token
        ? `${siteOrigin}/newsletter/unsubscribe?token=${encodeURIComponent(token)}`
        : null;

    const text =
        'Hi,\n\n' +
        'Thanks for subscribing to Qualitick Collections. You will hear from us when we have new collections and special offers.\n\n' +
        (unsubUrl
            ? `One-click unsubscribe (no login required): ${unsubUrl}\n\n`
            : '') +
        `This email was sent to ${to}.\n\n` +
        'Qualitick Collections\n';

    const unsubHtml = unsubUrl
        ? `<p style="font-size: 12px; color: #777;"><a href="${esc(unsubUrl)}">One-click unsubscribe</a> (no login required)</p>`
        : '';

    const html = `
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"></head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <p>Hi,</p>
                    <p>Thanks for subscribing to Qualitick Collections. You&rsquo;ll hear from us when we have new collections and special offers.</p>
                    ${unsubHtml}
                    <p style="font-size: 12px; color: #777;">This email was sent to ${esc(to)}.</p>
                    <p style="font-size: 12px; color: #777;">Qualitick Collections</p>
                </div>
            </body>
            </html>`;

    const mailOptions = {
        from: MAIL_FROM,
        to,
        subject: "You're subscribed - Qualitick Collections",
        text,
        html
    };
    if (unsubUrl) {
        mailOptions.headers = {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        };
    }

    try {
        const info = await transporter.sendMail(mailOptions);
        logger.info({ messageId: info.messageId }, 'Newsletter welcome email sent');
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error({ err: error }, 'Error sending newsletter welcome email');
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendContactNotificationToAdmin,
    sendContactConfirmationToUser,
    sendInvoiceEmail,
    sendOrderNotificationToAdmin,
    sendLowStockNotificationToAdmin,
    sendPaymentNotificationToAdmin,
    sendCustomerEmailVerification,
    sendCustomerPasswordResetEmail,
    sendOrderConfirmationEmail,
    sendDispatchEmail,
    sendNewsletterWelcomeEmail,
    verifyTransporter
};

