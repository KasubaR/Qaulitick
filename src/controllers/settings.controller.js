const settingsService = require('../services/settings.service');
const emailService = require('../services/email.service');
const lencoService = require('../services/lenco.service');

/**
 * Settings Controller
 * 
 * Handles API endpoints for admin settings management
 */

/**
 * Get all settings
 * GET /api/admin/settings
 */
exports.getSettings = async (req, res) => {
    try {
        const settings = await settingsService.getSettings();
        
        // Convert to plain object and structure response
        const settingsObj = settings.toJSON();
        
        res.json({
            success: true,
            data: {
                general: settingsObj.general || {},
                store: settingsObj.store || {},
                payment: settingsObj.payment || {},
                email: settingsObj.email || {},
                security: settingsObj.security || {},
                notifications: settingsObj.notifications || {}
            }
        });
    } catch (error) {
        console.error('[Settings Controller] Error getting settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve settings',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get notification settings only
 * GET /api/admin/settings/notifications
 */
exports.getNotificationSettings = async (req, res) => {
    try {
        const notificationSettings = await settingsService.getNotificationSettings();
        
        res.json({
            success: true,
            data: notificationSettings
        });
    } catch (error) {
        console.error('[Settings Controller] Error getting notification settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve notification settings',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Update settings by category
 * PUT /api/admin/settings/:category
 */
exports.updateSettings = async (req, res) => {
    try {
        const { category } = req.params;
        const data = req.body;
        
        // Validate category
        const validCategories = ['general', 'store', 'payment', 'email', 'security', 'notifications'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({
                success: false,
                message: `Invalid settings category. Valid categories: ${validCategories.join(', ')}`
            });
        }
        
        // Validate that data is provided
        if (!data || Object.keys(data).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Settings data is required'
            });
        }
        
        // Update settings
        const updatedSettings = await settingsService.updateSettings(category, data);
        
        // Get the updated category data
        const settingsObj = updatedSettings.toJSON();
        const categoryData = settingsObj[category] || {};
        
        res.json({
            success: true,
            message: `${category} settings updated successfully`,
            data: {
                [category]: categoryData
            }
        });
    } catch (error) {
        console.error(`[Settings Controller] Error updating ${req.params.category} settings:`, error);
        res.status(500).json({
            success: false,
            message: `Failed to update ${req.params.category} settings`,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Send test notification email
 * POST /api/admin/settings/test-email
 */
exports.testEmail = async (req, res) => {
    try {
        // Get notification email from settings
        const notificationEmail = await settingsService.getNotificationEmail();
        
        if (!notificationEmail) {
            return res.status(400).json({
                success: false,
                message: 'Notification email is not configured'
            });
        }
        
        // Check if email service is configured
        const transporter = emailService.createTransporter ? emailService.createTransporter() : null;
        if (!transporter) {
            return res.status(503).json({
                success: false,
                message: 'Email service is not configured. Please configure SMTP settings first.'
            });
        }
        
        // Create test email content
        const testEmailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #FFEEC1 0%, #FFD700 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
                    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
                    .success-box { background: white; padding: 20px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #28a745; }
                    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #777; text-align: center; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1 style="margin: 0; color: #333;">Test Email - Qualitick Collections</h1>
                    </div>
                    <div class="content">
                        <p>Hello,</p>
                        <p>This is a test email from your Qualitick Collections admin panel.</p>
                        <div class="success-box">
                            <strong>✓ Email Configuration Successful!</strong><br>
                            Your notification email settings are working correctly.
                        </div>
                        <p>If you received this email, your email service is properly configured and ready to send notifications.</p>
                        <div class="footer">
                            <p><strong>Qualitick Collections</strong></p>
                            <p>This is an automated test email. Please do not reply.</p>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;
        
        // Send test email using nodemailer directly (since emailService might not have a generic send method)
        const nodemailer = require('nodemailer');
        const gmailUser = process.env.GMAIL_USER;
        const gmailPassword = process.env.GMAIL_APP_PASSWORD;
        
        if (!gmailUser || !gmailPassword) {
            return res.status(503).json({
                success: false,
                message: 'Email service is not configured. Please set GMAIL_USER and GMAIL_APP_PASSWORD environment variables.'
            });
        }
        
        const testTransporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: gmailUser,
                pass: gmailPassword
            }
        });
        
        const mailOptions = {
            from: `"Qualitick Collections" <${gmailUser}>`,
            to: notificationEmail,
            subject: 'Test Email - Qualitick Collections Admin Panel',
            html: testEmailHtml
        };
        
        const info = await testTransporter.sendMail(mailOptions);
        
        console.log(`[Settings Controller] Test email sent to ${notificationEmail}: ${info.messageId}`);
        
        res.json({
            success: true,
            message: `Test email sent successfully to ${notificationEmail}`,
            data: {
                messageId: info.messageId,
                recipient: notificationEmail
            }
        });
    } catch (error) {
        console.error('[Settings Controller] Error sending test email:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send test email',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Test payment connection
 * POST /api/admin/settings/test-payment
 */
exports.testPayment = async (req, res) => {
    try {
        const settings = await settingsService.getSettings();
        const settingsObj = settings.toJSON();
        const paymentSettings = settingsObj.payment || {};
        
        // Check if payment settings are configured
        if (!paymentSettings.lencoApiBaseUrl || !paymentSettings.lencoApiSecretKey) {
            return res.status(400).json({
                success: false,
                message: 'Payment gateway settings are not configured. Please configure Lenco API settings first.'
            });
        }
        
        // Make a real API call to Lenco to verify credentials — getBanks is a lightweight
        // authenticated GET that fails immediately with 401 if the key is invalid.
        try {
            await lencoService.getBanks();
        } catch (lencoErr) {
            return res.status(502).json({
                success: false,
                message: 'Payment gateway credentials are invalid or Lenco is unreachable.',
                data: {
                    configured: true,
                    environment: paymentSettings.lencoEnvironment || 'production',
                    connected: false
                }
            });
        }

        res.json({
            success: true,
            message: 'Payment gateway connected successfully',
            data: {
                configured: true,
                environment: paymentSettings.lencoEnvironment || 'production',
                connected: true
            }
        });
    } catch (error) {
        console.error('[Settings Controller] Error testing payment connection:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to test payment connection',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

