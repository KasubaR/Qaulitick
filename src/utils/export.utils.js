// Export Utilities
// Shared functions for CSV and JSON export generation

/**
 * Escape CSV cell content
 * Handles commas, quotes, and newlines in CSV cells
 * @param {*} cell - Cell value to escape
 * @returns {string} Escaped CSV cell
 */
function escapeCsvCell(cell) {
    if (cell === null || cell === undefined) return '';
    const str = String(cell);
    // Escape quotes and wrap in quotes if contains comma, newline, or quote
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Generate CSV content from data
 * @param {Array<string>} headers - Column headers
 * @param {Array<Array>} rows - Data rows (array of arrays)
 * @param {Array<Array>} metadataRows - Optional metadata rows to prepend (e.g., statistics)
 * @returns {string} CSV content
 */
function generateCSV(headers, rows, metadataRows = []) {
    const csvRows = [];
    
    // Add metadata rows if provided
    if (metadataRows.length > 0) {
        metadataRows.forEach(row => {
            csvRows.push(row.map(escapeCsvCell).join(','));
        });
        csvRows.push(''); // Empty row separator
    }
    
    // Add headers
    csvRows.push(headers.map(escapeCsvCell).join(','));
    
    // Add data rows
    rows.forEach(row => {
        csvRows.push(row.map(escapeCsvCell).join(','));
    });
    
    return csvRows.join('\n');
}

/**
 * Generate JSON export data structure
 * @param {Object} data - Data to export
 * @param {Object} metadata - Optional metadata (statistics, filters, etc.)
 * @returns {Object} Formatted JSON export data
 */
function generateJSON(data, metadata = {}) {
    const exportDate = new Date().toISOString().split('T')[0];
    
    return {
        exportDate: exportDate,
        exportTime: new Date().toISOString(),
        ...metadata,
        data: data
    };
}

/**
 * Format currency for export
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
 * Format date for export
 * @param {Date|string} date - Date to format
 * @param {boolean} includeTime - Whether to include time
 * @returns {string} Formatted date string
 */
function formatDate(date, includeTime = false) {
    if (!date) return '';
    const d = new Date(date);
    
    if (includeTime) {
        return d.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
    
    return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

/**
 * Set export response headers
 * @param {Object} res - Express response object
 * @param {string} format - Export format ('csv' or 'json')
 * @param {string} filename - Filename for download
 */
function setExportHeaders(res, format, filename) {
    if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
    } else {
        res.setHeader('Content-Type', 'text/csv');
    }
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

module.exports = {
    escapeCsvCell,
    generateCSV,
    generateJSON,
    formatCurrency,
    formatDate,
    setExportHeaders
};

