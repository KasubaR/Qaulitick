// Layby Export Service
// Builds flat row data from enriched layby plans and renders it as PDF, XLSX, or DOCX.

// pdfkit/exceljs/docx are required lazily (inside each generate* function) rather
// than at module load time. This file is pulled in at server boot (app.js ->
// admin.routes.js -> admin.layby.controller.js), so a top-level require() of a
// missing/uninstalled package here used to crash the *entire* process on startup
// instead of just failing the one export request. Lazy-loading turns a missing
// dependency into a normal 500 on the export endpoint.
function requireOptional(moduleName, humanName) {
    try {
        return require(moduleName);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            const wrapped = new Error(`${humanName} export is unavailable: '${moduleName}' is not installed on this server. Run "npm install" and try again.`);
            wrapped.statusCode = 503;
            wrapped.isOperational = true;
            throw wrapped;
        }
        throw err;
    }
}

const MAX_EXPORT_ROWS = 5000;

const COLUMNS = [
    { key: 'id', label: 'ID', width: 45 },
    { key: 'reference', label: 'Reference', width: 90 },
    { key: 'customer', label: 'Customer', width: 140 },
    { key: 'status', label: 'Status', width: 130 },
    { key: 'amountPaid', label: 'Paid', width: 80 },
    { key: 'balanceRemaining', label: 'Balance', width: 80 },
    { key: 'nextAction', label: 'Next action', width: 110 },
    { key: 'nextDue', label: 'Next due', width: 80 }
];

/**
 * Flattens an enriched layby plan (see laybyStatusPresenter.enrichLaybyPlan) into an export row.
 * @param {Object} plan - Enriched plan (plain object)
 */
function toExportRow(plan) {
    const reference = (plan.order && plan.order.orderNumber) || (plan.offlineSale && plan.offlineSale.saleNumber) || '—';
    const customer = (plan.user && (plan.user.name || plan.user.email)) || (plan.offlineSale && plan.offlineSale.customerName) || '—';
    const currency = plan.currency || 'ZMW';

    return {
        id: plan.id,
        reference,
        customer,
        status: plan.laybyDisplayStatus || plan.status || '—',
        amountPaid: `${formatMoney(plan.amountPaid)} ${currency}`,
        balanceRemaining: `${formatMoney(plan.balanceRemaining)} ${currency}`,
        nextAction: plan.nextActionLabel || '—',
        nextDue: plan.nextDueLabel || '—',
        createdAt: formatDate(plan.createdAt)
    };
}

function formatMoney(n) {
    const x = Number(n);
    if (Number.isNaN(x)) return '0.00';
    return x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-ZM');
}

/**
 * @param {Array<Object>} plans - Enriched layby plans
 * @returns {Array<Object>} Flat export rows
 */
function buildExportRows(plans) {
    return plans.map(toExportRow);
}

/**
 * @param {Array<Object>} rows - Rows from buildExportRows
 * @returns {Promise<Buffer>}
 */
async function generateLaybyPDF(rows) {
    const PDFDocument = requireOptional('pdfkit', 'PDF');
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                layout: 'landscape',
                margin: 40,
                info: {
                    Title: 'Layby Plans Export',
                    Author: 'Qualitick Collections',
                    Creator: 'Qualitick Collections Admin Panel'
                }
            });

            const chunks = [];
            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const tableX = 40;
            const tableWidth = doc.page.width - 80;

            doc.fontSize(18).fillColor('#1a1a1a').text('Layby Plans', tableX, 40);
            doc.fontSize(9).fillColor('#666666').text(`Exported ${new Date().toLocaleString('en-ZM')} — ${rows.length} plan${rows.length === 1 ? '' : 's'}`, tableX, 62);

            const renderHeader = (y) => {
                doc.fontSize(9).fillColor('#ffffff').rect(tableX, y, tableWidth, 22).fill('#1a1a1a');
                let x = tableX;
                COLUMNS.forEach((col) => {
                    doc.fillColor('#ffffff').text(col.label, x + 5, y + 6, { width: col.width - 5 });
                    x += col.width;
                });
                return y + 22;
            };

            let currentY = renderHeader(90);

            rows.forEach((row, index) => {
                if (currentY > doc.page.height - 60) {
                    doc.addPage();
                    currentY = renderHeader(40);
                }

                if (index % 2 === 0) {
                    doc.rect(tableX, currentY, tableWidth, 20).fill('#f5f5f5');
                }

                let x = tableX;
                doc.fontSize(8).fillColor('#333333');
                COLUMNS.forEach((col) => {
                    doc.text(String(row[col.key] ?? '—'), x + 5, currentY + 5, { width: col.width - 8, ellipsis: true });
                    x += col.width;
                });

                currentY += 20;
            });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * @param {Array<Object>} rows - Rows from buildExportRows
 * @returns {Promise<Buffer>}
 */
async function generateLaybyXLSX(rows) {
    const ExcelJS = requireOptional('exceljs', 'Excel');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Qualitick Collections Admin Panel';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Layby Plans');

    sheet.columns = COLUMNS.map((col) => ({
        header: col.label,
        key: col.key,
        width: Math.max(12, Math.round(col.width / 6))
    }));

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1A' } };
    sheet.getRow(1).alignment = { vertical: 'middle' };

    rows.forEach((row) => {
        sheet.addRow(row);
    });

    sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + COLUMNS.length)}1` };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    return workbook.xlsx.writeBuffer();
}

/**
 * @param {Array<Object>} rows - Rows from buildExportRows
 * @returns {Promise<Buffer>}
 */
async function generateLaybyDOCX(rows) {
    const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, ShadingType } = requireOptional('docx', 'Word');
    const headerCells = COLUMNS.map((col) => new TableCell({
        shading: { type: ShadingType.SOLID, color: '1A1A1A', fill: '1A1A1A' },
        children: [new Paragraph({
            children: [new TextRun({ text: col.label, bold: true, color: 'FFFFFF' })]
        })]
    }));

    const bodyRows = rows.map((row, index) => new TableRow({
        children: COLUMNS.map((col) => new TableCell({
            shading: index % 2 === 0 ? { type: ShadingType.SOLID, color: 'F5F5F5', fill: 'F5F5F5' } : undefined,
            children: [new Paragraph({ children: [new TextRun({ text: String(row[col.key] ?? '—'), size: 16 })] })]
        }))
    }));

    const doc = new Document({
        sections: [{
            properties: { page: { size: { orientation: 'landscape' } } },
            children: [
                new Paragraph({
                    children: [new TextRun({ text: 'Layby Plans', bold: true, size: 32 })]
                }),
                new Paragraph({
                    children: [new TextRun({
                        text: `Exported ${new Date().toLocaleString('en-ZM')} — ${rows.length} plan${rows.length === 1 ? '' : 's'}`,
                        size: 18,
                        color: '666666'
                    })]
                }),
                new Paragraph({ text: '' }),
                new Table({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [new TableRow({ children: headerCells }), ...bodyRows]
                })
            ]
        }]
    });

    return Packer.toBuffer(doc);
}

module.exports = {
    MAX_EXPORT_ROWS,
    buildExportRows,
    generateLaybyPDF,
    generateLaybyXLSX,
    generateLaybyDOCX
};
