// GA4 Service
// Handles Google Analytics 4 API integration

/**
 * GA4 Service
 * 
 * Provides methods to interact with Google Analytics 4 Data API
 * Requires: @google-analytics/data package
 * Requires: GA4_SERVICE_ACCOUNT_KEY_PATH environment variable
 * Requires: GA4_PROPERTY_ID environment variable
 */

let analyticsDataClient = null;

/**
 * Initialize GA4 client
 * @returns {Object|null} GA4 client instance or null if not configured
 */
function getGA4Client() {
    // Check if GA4 is configured
    if (!process.env.GA4_PROPERTY_ID || !process.env.GA4_SERVICE_ACCOUNT_KEY_PATH) {
        return null;
    }

    // Lazy load the client
    if (!analyticsDataClient) {
        try {
            const { BetaAnalyticsDataClient } = require('@google-analytics/data');
            analyticsDataClient = new BetaAnalyticsDataClient({
                keyFilename: process.env.GA4_SERVICE_ACCOUNT_KEY_PATH
            });
        } catch (error) {
            console.warn('[GA4 Service] @google-analytics/data package not installed. Install with: npm install @google-analytics/data');
            return null;
        }
    }

    return analyticsDataClient;
}

/**
 * Check if GA4 is configured
 * @returns {boolean}
 */
function isGA4Configured() {
    return !!(
        process.env.GA4_PROPERTY_ID && 
        process.env.GA4_SERVICE_ACCOUNT_KEY_PATH &&
        getGA4Client()
    );
}

/**
 * Get analytics data from GA4
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @param {Array<string>} metrics - Optional metrics to fetch
 * @returns {Promise<Object>} Formatted analytics data
 */
async function getAnalyticsData(startDate, endDate, metrics = []) {
    const client = getGA4Client();
    
    if (!client) {
        throw new Error('GA4 is not configured. Please set GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT_KEY_PATH environment variables.');
    }

    const propertyId = process.env.GA4_PROPERTY_ID;
    const property = `properties/${propertyId}`;

    try {
        // Default metrics if none specified
        const defaultMetrics = [
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'sessions' },
            { name: 'bounceRate' },
            { name: 'averageSessionDuration' }
        ];

        const metricsToFetch = metrics.length > 0 
            ? metrics.map(m => ({ name: m }))
            : defaultMetrics;

        // Run report
        const [response] = await client.runReport({
            property: property,
            dateRanges: [
                {
                    startDate: startDate,
                    endDate: endDate,
                },
            ],
            dimensions: [
                { name: 'date' },
                { name: 'pagePath' },
                { name: 'deviceCategory' },
                { name: 'country' },
                { name: 'sessionSource' },
                { name: 'browser' },
            ],
            metrics: metricsToFetch,
        });

        // Process response
        return processGA4Response(response, startDate, endDate);
    } catch (error) {
        console.error('[GA4 Service] Error fetching analytics data:', error);
        throw error;
    }
}

/**
 * Get real-time analytics data from GA4
 * @returns {Promise<Object>} Real-time analytics data
 */
async function getRealTimeData() {
    const client = getGA4Client();
    
    if (!client) {
        throw new Error('GA4 is not configured. Please set GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT_KEY_PATH environment variables.');
    }

    const propertyId = process.env.GA4_PROPERTY_ID;
    const property = `properties/${propertyId}`;

    try {
        // Run real-time report
        const [response] = await client.runRealtimeReport({
            property: property,
            dimensions: [
                { name: 'country' },
                { name: 'pagePath' },
                { name: 'deviceCategory' },
            ],
            metrics: [
                { name: 'activeUsers' },
            ],
        });

        // Process real-time response
        return processGA4RealtimeResponse(response);
    } catch (error) {
        console.error('[GA4 Service] Error fetching real-time data:', error);
        throw error;
    }
}

/**
 * Process GA4 report response into formatted data
 * @param {Object} response - GA4 API response
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @returns {Object} Formatted analytics data
 */
function processGA4Response(response, startDate, endDate) {
    const rows = response.rows || [];
    
    // Initialize data structure
    const data = {
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
    };

    // Aggregators
    const pageViewsMap = new Map();
    const trafficSourcesMap = new Map();
    const devicesMap = new Map();
    const browsersMap = new Map();
    const timeSeriesMap = new Map();

    // Process rows
    rows.forEach(row => {
        const dimensionValues = row.dimensionValues || [];
        const metricValues = row.metricValues || [];

        // Extract dimensions
        const date = dimensionValues[0]?.value || '';
        const pagePath = dimensionValues[1]?.value || '';
        const deviceCategory = dimensionValues[2]?.value || '';
        const country = dimensionValues[3]?.value || '';
        const sessionSource = dimensionValues[4]?.value || '';
        const browser = dimensionValues[5]?.value || '';

        // Extract metrics
        const activeUsers = parseInt(metricValues[0]?.value || '0', 10);
        const screenPageViews = parseInt(metricValues[1]?.value || '0', 10);
        const sessions = parseInt(metricValues[2]?.value || '0', 10);
        const bounceRate = parseFloat(metricValues[3]?.value || '0');
        const avgSessionDuration = parseFloat(metricValues[4]?.value || '0');

        // Aggregate summary
        data.summary.users += activeUsers;
        data.summary.sessions += sessions;
        data.summary.pageViews += screenPageViews;
        data.summary.bounceRate += bounceRate;
        data.summary.avgSessionDuration += avgSessionDuration;

        // Aggregate top pages
        if (pagePath) {
            const current = pageViewsMap.get(pagePath) || 0;
            pageViewsMap.set(pagePath, current + screenPageViews);
        }

        // Aggregate traffic sources
        if (sessionSource) {
            const current = trafficSourcesMap.get(sessionSource) || 0;
            trafficSourcesMap.set(sessionSource, current + sessions);
        }

        // Aggregate devices
        if (deviceCategory) {
            const current = devicesMap.get(deviceCategory) || 0;
            devicesMap.set(deviceCategory, current + sessions);
        }

        // Aggregate browsers
        if (browser) {
            const current = browsersMap.get(browser) || 0;
            browsersMap.set(browser, current + sessions);
        }

        // Aggregate time series
        if (date) {
            const current = timeSeriesMap.get(date) || { users: 0, sessions: 0, pageViews: 0 };
            timeSeriesMap.set(date, {
                users: current.users + activeUsers,
                sessions: current.sessions + sessions,
                pageViews: current.pageViews + screenPageViews
            });
        }
    });

    // Calculate averages
    const rowCount = rows.length || 1;
    data.summary.bounceRate = data.summary.bounceRate / rowCount;
    data.summary.avgSessionDuration = data.summary.avgSessionDuration / rowCount;

    // Convert maps to arrays and sort
    data.topPages = Array.from(pageViewsMap.entries())
        .map(([path, views]) => ({
            path: path,
            views: views,
            percentage: (views / data.summary.pageViews) * 100
        }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 10);

    data.trafficSources = Array.from(trafficSourcesMap.entries())
        .map(([source, sessions]) => ({
            source: source,
            sessions: sessions,
            percentage: (sessions / data.summary.sessions) * 100
        }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 10);

    data.devices = Array.from(devicesMap.entries())
        .map(([device, sessions]) => ({
            device: device,
            sessions: sessions,
            percentage: (sessions / data.summary.sessions) * 100
        }))
        .sort((a, b) => b.sessions - a.sessions);

    data.browsers = Array.from(browsersMap.entries())
        .map(([browser, sessions]) => ({
            browser: browser,
            sessions: sessions,
            percentage: (sessions / data.summary.sessions) * 100
        }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 10);

    // Convert time series map to array and sort by date
    data.timeSeries = Array.from(timeSeriesMap.entries())
        .map(([date, metrics]) => ({
            date: date,
            users: metrics.users,
            sessions: metrics.sessions,
            pageViews: metrics.pageViews
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return data;
}

/**
 * Process GA4 real-time response
 * @param {Object} response - GA4 real-time API response
 * @returns {Object} Formatted real-time data
 */
function processGA4RealtimeResponse(response) {
    const rows = response.rows || [];
    
    const data = {
        activeUsers: 0,
        topPages: [],
        topCountries: []
    };

    const pagesMap = new Map();
    const countriesMap = new Map();

    rows.forEach(row => {
        const dimensionValues = row.dimensionValues || [];
        const metricValues = row.metricValues || [];

        const country = dimensionValues[0]?.value || '';
        const pagePath = dimensionValues[1]?.value || '';
        const deviceCategory = dimensionValues[2]?.value || '';
        const activeUsers = parseInt(metricValues[0]?.value || '0', 10);

        data.activeUsers += activeUsers;

        if (pagePath) {
            const current = pagesMap.get(pagePath) || 0;
            pagesMap.set(pagePath, current + activeUsers);
        }

        if (country) {
            const current = countriesMap.get(country) || 0;
            countriesMap.set(country, current + activeUsers);
        }
    });

    data.topPages = Array.from(pagesMap.entries())
        .map(([path, users]) => ({ path, users }))
        .sort((a, b) => b.users - a.users)
        .slice(0, 10);

    data.topCountries = Array.from(countriesMap.entries())
        .map(([country, users]) => ({ country, users }))
        .sort((a, b) => b.users - a.users)
        .slice(0, 10);

    return data;
}

module.exports = {
    isGA4Configured,
    getAnalyticsData,
    getRealTimeData
};

