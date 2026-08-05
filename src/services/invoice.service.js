// Invoice Service
// Generates PDF invoices for orders using PDFKit, styled to match the
// Qualitick Collections letterhead invoice template (Qualitick-Invoice.pdf).

const PDFDocument = require('pdfkit');
const path = require('path');

// ---- Brand assets ----
// Rasterized from public/images/icons/logo_black name.svg (see scripts that
// generated it) so PDFKit can embed it — PDFKit cannot draw SVGs directly.
const LOGO_PATH = path.join(__dirname, '../../public/images/icons/logo-invoice.png');
// Rasterized from public/images/icons/watermark-half.svg — the same diagonal
// chevron ribbon used as the background watermark on the reference letterhead.
const WATERMARK_PATH = path.join(__dirname, '../../public/images/icons/watermark-invoice.png');
const FONT_REGULAR_PATH = path.join(__dirname, '../../public/fonts/OTF/Satoshi-Regular.otf');
const FONT_MEDIUM_PATH = path.join(__dirname, '../../public/fonts/OTF/Satoshi-Medium.otf');
const FONT_BOLD_PATH = path.join(__dirname, '../../public/fonts/OTF/Satoshi-Bold.otf');

// ---- Brand palette (matches the logo and Qualitick-Invoice.pdf letterhead) ----
const GOLD = '#b09144';
const DARK = '#171717';
const BAR_DARK = '#404040';
const GRAY = '#666666';
const BORDER = '#e6dcc2';

// Fixed company/letterhead details (the physical business info printed on
// every invoice — not order-specific, so not stored per-order in the DB).
const COMPANY = {
    phone: '+260 975 587 617', // WhatsApp number
    email: 'support@qualitickzm.com',
    tpin: 'TPIN: 1005834979'
};

const PAGE_LEFT = 50;
const PAGE_RIGHT = 545; // printable right edge on A4 with 50pt margins

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
 * Render a line of text and return the y position of the line below it,
 * measuring the actual rendered height (including wraps) instead of a
 * hardcoded offset so following lines never overlap.
 * @param {Object} doc - PDFKit document
 * @param {string} text - Text to render
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {Object} options - PDFKit text options (width required for wrapping fields)
 * @returns {number} Y position for the next line
 */
function writeLine(doc, text, x, y, options = {}) {
    const { gap = 4, ...textOptions } = options;
    const sanitized = sanitizeTextField(text, options.maxLength || 200);
    safeText(doc, sanitized, x, y, textOptions);
    const height = sanitized ? (doc.heightOfString(sanitized, textOptions) || doc.currentLineHeight()) : doc.currentLineHeight();
    return y + height + gap;
}

/**
 * Register the brand font (Satoshi) on the document, falling back to
 * PDFKit's built-in Helvetica if the font files are unavailable.
 * @param {Object} doc - PDFKit document
 */
function registerFonts(doc) {
    try {
        doc.registerFont('Body', FONT_REGULAR_PATH);
        doc.registerFont('Body-Medium', FONT_MEDIUM_PATH);
        doc.registerFont('Body-Bold', FONT_BOLD_PATH);
    } catch (error) {
        console.warn('[Invoice Service] Could not load brand font, falling back to Helvetica:', error.message);
        doc.registerFont('Body', 'Helvetica');
        doc.registerFont('Body-Medium', 'Helvetica-Bold');
        doc.registerFont('Body-Bold', 'Helvetica-Bold');
    }
}

/**
 * Draw the brand watermark (watermark-half.svg) across the full page,
 * behind all other content, matching the reference letterhead.
 * @param {Object} doc - PDFKit document
 */
function drawWatermark(doc) {
    try {
        doc.image(WATERMARK_PATH, 0, 0, { width: doc.page.width, height: doc.page.height });
    } catch (error) {
        console.warn('[Invoice Service] Could not draw watermark:', error.message);
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

            registerFonts(doc);

            // Collect PDF data chunks
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Starts a new page and redraws the watermark on it
            const newPage = () => {
                doc.addPage();
                drawWatermark(doc);
            };

            drawWatermark(doc);

            // ---- Letterhead: logo + contact block + invoice number bar ----
            try {
                doc.image(LOGO_PATH, PAGE_LEFT, 40, { width: 100 });
            } catch (logoError) {
                console.warn('[Invoice Service] Could not embed logo:', logoError.message);
            }

            const contactX = 300;
            const contactWidth = PAGE_RIGHT - contactX;
            doc.font('Body').fontSize(10).fillColor(GOLD);
            safeText(doc, COMPANY.phone, contactX, 48, { align: 'right', width: contactWidth });
            safeText(doc, COMPANY.email, contactX, 63, { align: 'right', width: contactWidth });
            safeText(doc, COMPANY.tpin, contactX, 78, { align: 'right', width: contactWidth });

            const invBarY = 102;
            const invBarHeight = 25;
            doc.rect(contactX, invBarY, contactWidth, invBarHeight).fill(BAR_DARK);
            doc.font('Body-Bold').fontSize(10).fillColor('#ffffff');
            safeText(doc, `INV. No. : ${sanitizeTextField(order.orderNumber, 50)}`, contactX + 12, invBarY + 8, { width: contactWidth - 20 });

            doc.font('Body').fontSize(10).fillColor(GRAY);
            safeText(doc, `Date: ${formatDate(order.createdAt)}`, contactX, invBarY + invBarHeight + 12, { width: contactWidth });

            // ---- Recipient ----
            let cursorY = 178;
            doc.font('Body').fontSize(11).fillColor(GRAY);
            cursorY = writeLine(doc, 'Recipient:', PAGE_LEFT, cursorY, { width: 300, gap: 6 });

            doc.font('Body-Bold').fontSize(12).fillColor(DARK);
            cursorY = writeLine(doc, sanitizeTextField(order.customer?.name, 80) || 'Customer', PAGE_LEFT, cursorY, { width: 300, gap: 3 });

            doc.font('Body').fontSize(10).fillColor(GRAY);
            if (order.shipping && !order.shipping.pickup) {
                cursorY = writeLine(doc, sanitizeTextField(order.shipping?.address, 200) || '-', PAGE_LEFT, cursorY, { width: 280, gap: 2 });
                const cityLine = [sanitizeTextField(order.shipping?.city, 50), sanitizeTextField(order.shipping?.province, 50)].filter(Boolean).join(', ');
                if (cityLine) {
                    cursorY = writeLine(doc, cityLine, PAGE_LEFT, cursorY, { width: 280, gap: 2 });
                }
            } else {
                cursorY = writeLine(doc, 'Store Pickup', PAGE_LEFT, cursorY, { width: 280, gap: 2 });
            }

            // ---- Items table ----
            const colQtyX = 60, colQtyWidth = 50;
            const colDescX = 130, colDescWidth = 210;
            const colUnitX = 350, colUnitWidth = 100;
            const colTotalX = 460, colTotalWidth = 85;

            // Renders the item table header at y and returns the new currentY
            const renderTableHeader = (y) => {
                doc.rect(PAGE_LEFT, y, PAGE_RIGHT - PAGE_LEFT, 25).fill(GOLD);
                doc.font('Body-Bold').fontSize(10).fillColor(DARK);
                doc.text('Qty', colQtyX, y + 8, { width: colQtyWidth, align: 'center' });
                doc.text('Description', colDescX, y + 8, { width: colDescWidth });
                doc.text('Unit Price', colUnitX, y + 8, { width: colUnitWidth, align: 'right' });
                doc.text('Total Price', colTotalX, y + 8, { width: colTotalWidth, align: 'right' });
                return y + 35;
            };

            const tableStartY = Math.max(cursorY + 15, 175);
            let currentY = renderTableHeader(tableStartY);

            // Items
            order.items.forEach((item, index) => {
                try {
                    // Page break before this row if it would overflow the printable area
                    if (currentY > 700) {
                        newPage();
                        currentY = renderTableHeader(50);
                    }

                    doc.font('Body').fontSize(9).fillColor(DARK);
                    safeText(doc, String(item.quantity || 0).padStart(2, '0'), colQtyX, currentY, { width: colQtyWidth, align: 'center' });
                    safeText(doc, sanitizeTextField(item.name, 80) || 'Product', colDescX, currentY, { width: colDescWidth });
                    safeText(doc, formatCurrency(item.price || 0), colUnitX, currentY, { width: colUnitWidth, align: 'right' });
                    safeText(doc, formatCurrency((item.price || 0) * (item.quantity || 0)), colTotalX, currentY, { width: colTotalWidth, align: 'right' });

                    currentY += 28;
                    doc.strokeColor(BORDER).lineWidth(0.75)
                       .moveTo(PAGE_LEFT, currentY - 6).lineTo(PAGE_RIGHT, currentY - 6).stroke();
                } catch (itemError) {
                    console.warn(`[Invoice Service] Error rendering item ${index}:`, itemError.message);
                    // Continue with next item even if one fails
                    currentY += 28;
                }
            });

            // If totals + payment info + footer (~260pt) won't fit on the current page, start a new one
            if (currentY + 260 > doc.page.height - 50) {
                newPage();
                currentY = 50;
            }

            // ---- Totals ----
            // Two right-aligned columns that both stay within the printable
            // page width (A4 minus 50pt margins ends at x=545): a label
            // column ending at x=450 and a value column ending at x=545.
            const totalsStartY = currentY + 20;
            const totalsLabelX = 275;
            const totalsLabelWidth = 130;
            const totalsValueX = 405;
            const totalsValueWidth = 140;
            let totalsOffset = 0;

            doc.font('Body').fontSize(10).fillColor(GRAY);
            doc.text('Subtotal:', totalsLabelX, totalsStartY + totalsOffset, { width: totalsLabelWidth, align: 'right' });
            doc.fillColor(DARK).text(formatCurrency(order.totals?.subtotal || 0), totalsValueX, totalsStartY + totalsOffset, { width: totalsValueWidth, align: 'right' });

            totalsOffset += 18;
            if (order.totals?.discount > 0) {
                doc.fillColor(GRAY).text('Discount:', totalsLabelX, totalsStartY + totalsOffset, { width: totalsLabelWidth, align: 'right' });
                doc.fillColor(DARK).text(`-${formatCurrency(order.totals.discount)}`, totalsValueX, totalsStartY + totalsOffset, { width: totalsValueWidth, align: 'right' });
                totalsOffset += 18;
            }

            if (order.totals?.delivery > 0) {
                doc.fillColor(GRAY).text('Delivery Fee:', totalsLabelX, totalsStartY + totalsOffset, { width: totalsLabelWidth, align: 'right' });
                doc.fillColor(DARK).text(formatCurrency(order.totals.delivery), totalsValueX, totalsStartY + totalsOffset, { width: totalsValueWidth, align: 'right' });
                totalsOffset += 18;
            }

            // Total — bold, underlined twice in gold like the reference letterhead
            totalsOffset += 12;
            const totalY = totalsStartY + totalsOffset;
            doc.font('Body-Bold').fontSize(12).fillColor(DARK);
            doc.text('Total', totalsLabelX, totalY, { width: totalsLabelWidth, align: 'right' });
            doc.fontSize(13);
            doc.text(`ZMW ${formatCurrency(order.totals?.total || 0)}`, totalsValueX, totalY, { width: totalsValueWidth, align: 'right' });

            const totalLineY = totalY + 20;
            doc.strokeColor(GOLD).lineWidth(1)
               .moveTo(totalsLabelX, totalLineY).lineTo(PAGE_RIGHT, totalLineY).stroke()
               .moveTo(totalsLabelX, totalLineY + 3).lineTo(PAGE_RIGHT, totalLineY + 3).stroke();

            // ---- Payment & order status ----
            let paymentY = totalLineY + 25;
            doc.font('Body').fontSize(10);

            doc.fillColor(GRAY);
            paymentY = writeLine(doc, 'Order Status:', PAGE_LEFT, paymentY, { width: 200, gap: 2 });
            doc.fillColor(DARK).font('Body-Medium');
            paymentY = writeLine(doc, sanitizeTextField(order.status, 20).toUpperCase(), PAGE_LEFT, paymentY, { width: 200, gap: 8 });

            doc.font('Body').fillColor(GRAY);
            paymentY = writeLine(doc, 'Payment Method:', PAGE_LEFT, paymentY, { width: 200, gap: 2 });
            doc.fillColor(DARK).font('Body-Medium');
            paymentY = writeLine(doc, formatPaymentMethod(order.paymentMethod), PAGE_LEFT, paymentY, { width: 200, gap: 8 });

            doc.font('Body').fillColor(GRAY);
            paymentY = writeLine(doc, 'Payment Status:', PAGE_LEFT, paymentY, { width: 200, gap: 2 });
            doc.fillColor(DARK).font('Body-Medium');
            paymentY = writeLine(doc, sanitizeTextField(order.paymentStatus || 'pending', 20).toUpperCase(), PAGE_LEFT, paymentY, { width: 200, gap: 8 });

            if (order.transactionId) {
                doc.font('Body').fillColor(GRAY);
                paymentY = writeLine(doc, 'Transaction ID:', PAGE_LEFT, paymentY, { width: 300, gap: 2 });
                doc.fillColor(DARK).font('Body-Medium');
                paymentY = writeLine(doc, sanitizeTextField(order.transactionId, 100), PAGE_LEFT, paymentY, { width: 300, gap: 8 });
            }

            // ---- Footer — anchored to the bottom of the last (current) page ----
            const footerY = doc.page.height - 110;
            doc.font('Body').fontSize(9).fillColor(GRAY);
            doc.text('Thank you for your business.', PAGE_LEFT, footerY, { width: 400 });
            doc.text('Please contact us if you have any questions regarding this invoice.', PAGE_LEFT, footerY + 14, { width: 450 });

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
