// Invoice Service
// Generates PDF invoices for orders using PDFKit

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Strip control characters from string
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function stripControlCharacters(str) {
    if (!str || typeof str !== 'string') return '';
    // Remove control characters (0x00-0x1F and 0x7F-0x9F) except newline, tab, carriage return
    return str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '');
}

/**
 * Truncate string to maximum length
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
function truncateString(str, maxLength) {
    if (!str || typeof str !== 'string') return '';
    const sanitized = stripControlCharacters(str);
    if (sanitized.length <= maxLength) return sanitized;
    return sanitized.substring(0, maxLength - 3) + '...';
}

/**
 * Sanitize text field for PDF rendering
 * @param {string} value - Value to sanitize
 * @param {number} maxLength - Maximum length (default: 200)
 * @returns {string} Sanitized value
 */
function sanitizeTextField(value, maxLength = 200) {
    if (value === null || value === undefined) return '';
    return truncateString(String(value), maxLength);
}

/**
 * Safe PDF text rendering with error handling
 * @param {Object} doc - PDFKit document
 * @param {string} text - Text to render
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {Object} options - PDFKit text options
 * @returns {Object} PDFKit document (for chaining)
 */
function safeText(doc, text, x, y, options = {}) {
    try {
        const sanitized = sanitizeTextField(text, options.maxLength || 200);
        return doc.text(sanitized, x, y, options);
    } catch (error) {
        console.warn('[Invoice Service] Error rendering text field:', error.message);
        // Fallback: render placeholder if field fails
        try {
            return doc.text('[Invalid Data]', x, y, options);
        } catch (fallbackError) {
            // If even fallback fails, just return doc without rendering
            console.error('[Invoice Service] Critical error rendering text:', fallbackError.message);
            return doc;
        }
    }
}

/**
 * Generate PDF Invoice for an order
 * @param {Object} order - Order object from database
 * @param {Object} options - Options for invoice generation
 * @returns {Promise<Buffer>} PDF buffer
 */
async function generateInvoicePDF(order, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            // Create a new PDF document
            const doc = new PDFDocument({
                size: 'A4',
                margin: 50,
                info: {
                    Title: `Invoice - ${order.orderNumber}`,
                    Author: 'Qualitick Collections',
                    Subject: `Invoice for Order ${order.orderNumber}`,
                    Creator: 'Qualitick Collections E-commerce Platform'
                }
            });

            // Collect PDF data chunks
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Company Information
            doc.fontSize(24)
               .fillColor('#1a1a1a')
               .text('QUALITICK COLLECTIONS', 50, 50, { align: 'left' });

            doc.fontSize(10)
               .fillColor('#666666')
               .text('Luxury Watch Retailer', 50, 80)
               .text('Email: info@qualitickcollections.com', 50, 95)
               .text('Phone: +260 XXX XXX XXX', 50, 110);

            // Invoice Header
            doc.fontSize(20)
               .fillColor('#1a1a1a')
               .text('INVOICE', 400, 50, { align: 'right' });

            doc.fontSize(10)
               .fillColor('#666666');
            safeText(doc, `Invoice #: ${sanitizeTextField(order.orderNumber, 50)}`, 400, 80, { align: 'right' });
            safeText(doc, `Date: ${formatDate(order.createdAt)}`, 400, 95, { align: 'right' });
            safeText(doc, `Status: ${sanitizeTextField(order.status, 20).toUpperCase()}`, 400, 110, { align: 'right' });

            // Customer Information
            const customerY = 150;
            doc.fontSize(12)
               .fillColor('#1a1a1a')
               .text('Bill To:', 50, customerY);

            doc.fontSize(10)
               .fillColor('#333333');
            safeText(doc, sanitizeTextField(order.customer?.name, 80), 50, customerY + 20);
            safeText(doc, sanitizeTextField(order.customer?.email, 100), 50, customerY + 35);
            safeText(doc, sanitizeTextField(order.customer?.phone, 30), 50, customerY + 50);

            // Shipping Information
            if (order.shipping && !order.shipping.pickup) {
                doc.fontSize(12)
                   .fillColor('#1a1a1a')
                   .text('Ship To:', 300, customerY);

                doc.fontSize(10)
                   .fillColor('#333333');
                safeText(doc, sanitizeTextField(order.shipping?.address, 200) || '-', 300, customerY + 20, { width: 250 });
                safeText(doc, `${sanitizeTextField(order.shipping?.city, 50) || ''}, ${sanitizeTextField(order.shipping?.province, 50) || ''}`, 300, customerY + 35);
            } else {
                doc.fontSize(12)
                   .fillColor('#1a1a1a')
                   .text('Delivery Method:', 300, customerY);

                doc.fontSize(10)
                   .fillColor('#333333')
                   .text('Store Pickup', 300, customerY + 20);
            }

            // Items Table Header
            const tableStartY = customerY + 90;
            doc.fontSize(10)
               .fillColor('#ffffff')
               .rect(50, tableStartY, 500, 25)
               .fill('#1a1a1a');

            doc.text('Item', 60, tableStartY + 8)
               .text('Quantity', 250, tableStartY + 8)
               .text('Unit Price', 350, tableStartY + 8)
               .text('Total', 480, tableStartY + 8, { align: 'right' });

            // Items
            let currentY = tableStartY + 35;
            order.items.forEach((item, index) => {
                try {
                    // Alternate row colors
                    if (index % 2 === 0) {
                        doc.rect(50, currentY - 5, 500, 30)
                           .fill('#f5f5f5');
                    }

                    doc.fontSize(9)
                       .fillColor('#333333');
                    safeText(doc, sanitizeTextField(item.name, 80) || 'Product', 60, currentY, { width: 180 });
                    safeText(doc, String(item.quantity || 0), 250, currentY);
                    safeText(doc, `K${formatCurrency(item.price || 0)}`, 350, currentY);
                    safeText(doc, `K${formatCurrency((item.price || 0) * (item.quantity || 0))}`, 480, currentY, { align: 'right' });

                    // SKU if available
                    if (item.sku) {
                        doc.fontSize(8)
                           .fillColor('#666666');
                        safeText(doc, `SKU: ${sanitizeTextField(item.sku, 50)}`, 60, currentY + 15);
                    }

                    currentY += 35;
                } catch (itemError) {
                    console.warn(`[Invoice Service] Error rendering item ${index}:`, itemError.message);
                    // Continue with next item even if one fails
                    currentY += 35;
                }
            });

            // Totals Section
            const totalsStartY = currentY + 20;
            const totalsWidth = 200;
            const totalsX = 400;
            let totalsOffset = 0;

            doc.fontSize(10)
               .fillColor('#333333')
               .text('Subtotal:', totalsX, totalsStartY + totalsOffset, { width: totalsWidth, align: 'right' })
               .text(`K${formatCurrency(order.totals?.subtotal || 0)}`, totalsX + totalsWidth, totalsStartY + totalsOffset, { align: 'right' });

            totalsOffset += 20;
            if (order.totals?.discount > 0) {
                doc.text('Discount:', totalsX, totalsStartY + totalsOffset, { width: totalsWidth, align: 'right' })
                   .text(`-K${formatCurrency(order.totals.discount)}`, totalsX + totalsWidth, totalsStartY + totalsOffset, { align: 'right' });
                totalsOffset += 20;
            }

            if (order.totals?.delivery > 0) {
                doc.text('Delivery Fee:', totalsX, totalsStartY + totalsOffset, { width: totalsWidth, align: 'right' })
                   .text(`K${formatCurrency(order.totals.delivery)}`, totalsX + totalsWidth, totalsStartY + totalsOffset, { align: 'right' });
                totalsOffset += 20;
            }

            // Total
            totalsOffset += 10;
            const totalY = totalsStartY + totalsOffset;
            doc.fontSize(12)
               .fillColor('#1a1a1a')
               .text('Total:', totalsX, totalY, { width: totalsWidth, align: 'right' })
               .fontSize(14)
               .text(`K${formatCurrency(order.totals?.total || 0)}`, totalsX + totalsWidth, totalY, { align: 'right' });

            // Payment Information
            const paymentY = totalY + 40;
            doc.fontSize(10)
               .fillColor('#666666');
            safeText(doc, 'Payment Method:', 50, paymentY);
            doc.fillColor('#333333');
            safeText(doc, formatPaymentMethod(order.paymentMethod), 50, paymentY + 15);

            doc.fillColor('#666666');
            safeText(doc, 'Payment Status:', 50, paymentY + 35);
            doc.fillColor('#333333');
            safeText(doc, sanitizeTextField(order.paymentStatus || 'pending', 20).toUpperCase(), 50, paymentY + 50);

            if (order.transactionId) {
                doc.fillColor('#666666');
                safeText(doc, 'Transaction ID:', 50, paymentY + 70);
                doc.fillColor('#333333');
                safeText(doc, sanitizeTextField(order.transactionId, 100), 50, paymentY + 85);
            }

            // Footer
            const footerY = 750;
            doc.fontSize(8)
               .fillColor('#999999')
               .text('Thank you for your business!', 50, footerY, { align: 'center' })
               .text('This is a computer-generated invoice.', 50, footerY + 15, { align: 'center' });

            // Finalize PDF
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
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
 * Format date
 * @param {string|Date} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDate(date) {
    if (!date) return 'N/A';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
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

module.exports = {
    generateInvoicePDF
};

