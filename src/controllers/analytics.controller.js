/**
 * Analytics Controller
 * Handles analytics dashboard rendering and data fetching
 * 
 * Note: Full Google Analytics integration requires:
 * 1. Google Analytics service account credentials
 * 2. OAuth 2.0 setup OR
 * 3. Google Analytics Embed API with user authentication
 * 
 * For now, this provides a structure ready for GA4 API integration
 */

/**
 * Render the analytics dashboard page
 */
exports.renderAnalyticsPage = (req, res) => {
    try {
        res.render('admin/analytics', {
            title: 'Analytics Dashboard | Admin Panel',
            page: 'admin',
            activePage: 'analytics',
            // Pass GA4 Measurement ID if available
            GA4_MEASUREMENT_ID: process.env.GA4_MEASUREMENT_ID || null
        });
    } catch (error) {
        console.error('[Analytics Controller] Error rendering analytics page:', error);
        res.status(500).render('admin/analytics', {
            title: 'Analytics Dashboard | Admin Panel',
            page: 'admin',
            activePage: 'analytics',
            error: 'Failed to load analytics page'
        });
    }
};

/**
 * Get analytics data from Google Analytics API
 * 
 * This is a placeholder for GA4 Reporting API integration
 * To implement:
 * 1. Install: npm install @google-analytics/data
 * 2. Set up service account credentials
 * 3. Use GA4 Data API to fetch metrics
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
exports.getAnalyticsData = async (req, res) => {
    try {
        const { startDate, endDate, metrics } = req.query;
        
        // Validate date range
        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Start date and end date are required'
            });
        }

        // Try to use GA4 service if configured
        const ga4Service = require('../services/ga4.service');
        
        if (ga4Service.isGA4Configured()) {
            try {
                // Fetch real data from GA4
                const metricsList = metrics ? metrics.split(',') : [];
                const data = await ga4Service.getAnalyticsData(startDate, endDate, metricsList);
                
                res.json({
                    success: true,
                    data: data,
                    source: 'GA4'
                });
                return;
            } catch (ga4Error) {
                console.error('[Analytics Controller] GA4 API error, falling back to mock data:', ga4Error.message);
                // Fall through to mock data if GA4 fails
            }
        }

        // Return mock data if GA4 is not configured or fails
        const mockData = {
            success: true,
            data: {
                summary: {
                    users: 0,
                    sessions: 0,
                    pageViews: 0,
                    bounceRate: 0,
                    avgSessionDuration: 0
                },
                topPages: [],
                trafficSources: [],
                devices: [],
                browsers: [],
                conversions: {
                    addToCart: 0,
                    purchases: 0,
                    checkoutStarted: 0
                },
                timeSeries: []
            },
            message: ga4Service.isGA4Configured() 
                ? 'Analytics data endpoint ready. Connect GA4 API to fetch real data.'
                : 'GA4 is not configured. Set GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT_KEY_PATH environment variables.'
        };

        res.json(mockData);
    } catch (error) {
        console.error('[Analytics Controller] Error fetching analytics data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch analytics data',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get real-time analytics data
 * 
 * Placeholder for GA4 Real-time API integration
 */
exports.getRealTimeData = async (req, res) => {
    try {
        // Try to use GA4 service if configured
        const ga4Service = require('../services/ga4.service');
        
        if (ga4Service.isGA4Configured()) {
            try {
                // Fetch real-time data from GA4
                const data = await ga4Service.getRealTimeData();
                
                res.json({
                    success: true,
                    data: data,
                    source: 'GA4'
                });
                return;
            } catch (ga4Error) {
                console.error('[Analytics Controller] GA4 Real-time API error, falling back to mock data:', ga4Error.message);
                // Fall through to mock data if GA4 fails
            }
        }

        // Mock data for now if GA4 is not configured
        const mockData = {
            success: true,
            data: {
                activeUsers: 0,
                topPages: [],
                topCountries: []
            },
            message: ga4Service.isGA4Configured()
                ? 'Real-time data endpoint ready.'
                : 'GA4 is not configured. Set GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT_KEY_PATH environment variables.'
        };

        res.json(mockData);
    } catch (error) {
        console.error('[Analytics Controller] Error fetching real-time data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch real-time data'
        });
    }
};

/**
 * Export analytics data to CSV or JSON
 * GET /api/admin/analytics/export
 * 
 * Query params:
 * - format: 'csv' | 'json' (default: 'csv')
 * - startDate: Start date (YYYY-MM-DD)
 * - endDate: End date (YYYY-MM-DD)
 */
exports.exportAnalyticsData = async (req, res) => {
    try {
        const format = (req.query.format || 'csv').toLowerCase();
        const { startDate, endDate } = req.query;

        // Validate format
        if (format !== 'csv' && format !== 'json') {
            return res.status(400).json({
                success: false,
                message: 'Invalid format. Must be: csv or json.'
            });
        }

        // Validate date range
        if (!startDate || !endDate) {
            return res.status(400).json({
                success: false,
                message: 'Start date and end date are required'
            });
        }

        // Fetch analytics data
        let analyticsData;
        const ga4Service = require('../services/ga4.service');
        
        if (ga4Service.isGA4Configured()) {
            try {
                analyticsData = await ga4Service.getAnalyticsData(startDate, endDate);
            } catch (ga4Error) {
                console.error('[Analytics Controller] GA4 API error during export:', ga4Error.message);
                // Fall back to empty structure
                analyticsData = {
                    summary: { users: 0, sessions: 0, pageViews: 0, bounceRate: 0, avgSessionDuration: 0 },
                    topPages: [],
                    trafficSources: [],
                    devices: [],
                    browsers: [],
                    conversions: { addToCart: 0, purchases: 0, checkoutStarted: 0 },
                    timeSeries: []
                };
            }
        } else {
            // Return empty structure if GA4 not configured
            analyticsData = {
                summary: { users: 0, sessions: 0, pageViews: 0, bounceRate: 0, avgSessionDuration: 0 },
                topPages: [],
                trafficSources: [],
                devices: [],
                browsers: [],
                conversions: { addToCart: 0, purchases: 0, checkoutStarted: 0 },
                timeSeries: []
            };
        }

        const exportDate = new Date().toISOString().split('T')[0];

        if (format === 'json') {
            // Export as JSON
            const exportData = {
                exportDate: exportDate,
                exportTime: new Date().toISOString(),
                dateRange: {
                    startDate: startDate,
                    endDate: endDate
                },
                summary: analyticsData.summary,
                topPages: analyticsData.topPages,
                trafficSources: analyticsData.trafficSources,
                devices: analyticsData.devices,
                browsers: analyticsData.browsers,
                conversions: analyticsData.conversions,
                timeSeries: analyticsData.timeSeries
            };

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="analytics_export_${exportDate}.json"`);
            res.json(exportData);
        } else {
            // Export as CSV
            const escapeCsvCell = (cell) => {
                if (cell === null || cell === undefined) return '';
                const str = String(cell);
                if (str.includes(',') || str.includes('\n') || str.includes('"')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };

            // Build CSV content
            const csvRows = [];

            // Summary section
            csvRows.push('Summary Statistics');
            csvRows.push('Metric,Value');
            csvRows.push(`Total Users,${analyticsData.summary.users}`);
            csvRows.push(`Total Sessions,${analyticsData.summary.sessions}`);
            csvRows.push(`Total Page Views,${analyticsData.summary.pageViews}`);
            csvRows.push(`Bounce Rate,${analyticsData.summary.bounceRate.toFixed(2)}%`);
            csvRows.push(`Avg Session Duration,${analyticsData.summary.avgSessionDuration.toFixed(2)}s`);
            csvRows.push('');

            // Top Pages section
            csvRows.push('Top Pages');
            csvRows.push('Page Path,Page Views,Percentage');
            analyticsData.topPages.forEach(page => {
                csvRows.push(`${escapeCsvCell(page.path)},${page.views},${page.percentage.toFixed(2)}%`);
            });
            csvRows.push('');

            // Traffic Sources section
            csvRows.push('Traffic Sources');
            csvRows.push('Source,Sessions,Percentage');
            analyticsData.trafficSources.forEach(source => {
                csvRows.push(`${escapeCsvCell(source.source)},${source.sessions},${source.percentage.toFixed(2)}%`);
            });
            csvRows.push('');

            // Devices section
            csvRows.push('Devices');
            csvRows.push('Device,Sessions,Percentage');
            analyticsData.devices.forEach(device => {
                csvRows.push(`${escapeCsvCell(device.device)},${device.sessions},${device.percentage.toFixed(2)}%`);
            });
            csvRows.push('');

            // Browsers section
            csvRows.push('Browsers');
            csvRows.push('Browser,Sessions,Percentage');
            analyticsData.browsers.forEach(browser => {
                csvRows.push(`${escapeCsvCell(browser.browser)},${browser.sessions},${browser.percentage.toFixed(2)}%`);
            });
            csvRows.push('');

            // Conversions section
            csvRows.push('Conversions');
            csvRows.push('Event,Count');
            csvRows.push(`Add to Cart,${analyticsData.conversions.addToCart}`);
            csvRows.push(`Checkout Started,${analyticsData.conversions.checkoutStarted}`);
            csvRows.push(`Purchases,${analyticsData.conversions.purchases}`);
            csvRows.push('');

            // Time Series section
            csvRows.push('Time Series Data');
            csvRows.push('Date,Users,Sessions,Page Views');
            analyticsData.timeSeries.forEach(day => {
                csvRows.push(`${day.date},${day.users},${day.sessions},${day.pageViews}`);
            });

            const csvContent = csvRows.join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="analytics_export_${exportDate}.csv"`);
            res.send(csvContent);
        }
    } catch (error) {
        console.error('[Analytics Controller] Error exporting analytics data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to export analytics data'
        });
    }
};

