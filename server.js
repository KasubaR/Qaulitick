require('dotenv').config();
const app = require('./src/app');
const databaseService = require('./src/services/database.service');

// Server configuration
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Start the server
 */
async function startServer() {
    try {
        // Connect to database first
        console.log('🚀 Starting Qualitick Collections Server...');
        console.log(`📍 Environment: ${NODE_ENV}`);
        
        await databaseService.connect();

        // Verify email transporter early so auth failures surface at startup rather
        // than silently on the first real email. Skipped when credentials are absent
        // (e.g. local dev without Gmail configured). Non-fatal: a network/DNS error
        // at boot should not prevent the server from starting.
        if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
            const emailService = require('./src/services/email.service');
            try {
                await emailService.verifyTransporter();
            } catch (emailErr) {
                console.warn('⚠️  Email transporter verification failed (server will still start):', emailErr.message);
            }
        }

        // Start scheduled tasks
        const schedulerService = require('./src/services/scheduler.service');
        schedulerService.start();
        
        // Start Express server
        const server = app.listen(PORT, () => {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`✅ Server is running on port ${PORT}`);
            console.log(`🌐 URL: http://localhost:${PORT}`);
            console.log(`📊 Database Status: ${databaseService.getStatus()}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        });

        // Graceful shutdown
        process.on('SIGTERM', async () => {
            console.log('🛑 SIGTERM received, closing server gracefully...');
            schedulerService.stop();
            server.close(async () => {
                await databaseService.disconnect();
                console.log('👋 Server closed');
                process.exit(0);
            });
        });

        process.on('SIGINT', async () => {
            console.log('\n🛑 SIGINT received, closing server gracefully...');
            schedulerService.stop();
            server.close(async () => {
                await databaseService.disconnect();
                console.log('👋 Server closed');
                process.exit(0);
            });
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Start the server
startServer();
