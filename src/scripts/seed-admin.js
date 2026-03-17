require('dotenv').config();
const { connectDatabase } = require('../config/database');
const adminService = require('../services/admin.service');

/**
 * Admin Seeding Script
 * 
 * Creates the initial admin user from environment variables
 * 
 * Usage: node src/scripts/seed-admin.js
 * 
 * Required Environment Variables:
 * - ADMIN_EMAIL: Admin email address
 * - ADMIN_PASSWORD: Admin password (will be hashed automatically)
 * 
 * Optional Environment Variables:
 * - ADMIN_NAME: Admin name (defaults to email if not provided)
 */

/**
 * Seed admin user
 */
async function seedAdmin() {
    try {
        console.log('🌱 Starting admin user seed...');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // Check required environment variables
        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPassword = process.env.ADMIN_PASSWORD;
        const adminName = process.env.ADMIN_NAME || null;
        
        if (!adminEmail) {
            console.error('❌ Error: ADMIN_EMAIL environment variable is required');
            console.log('\nPlease add ADMIN_EMAIL to your .env file:');
            console.log('ADMIN_EMAIL=admin@qualitick.com');
            process.exit(1);
        }
        
        if (!adminPassword) {
            console.error('❌ Error: ADMIN_PASSWORD environment variable is required');
            console.log('\nPlease add ADMIN_PASSWORD to your .env file:');
            console.log('ADMIN_PASSWORD=your-secure-password-here');
            process.exit(1);
        }
        
        // Validate email format
        const emailRegex = /^\S+@\S+\.\S+$/;
        if (!emailRegex.test(adminEmail)) {
            console.error('❌ Error: Invalid email format');
            console.log(`   Provided: ${adminEmail}`);
            process.exit(1);
        }
        
        // Validate password length
        if (adminPassword.length < 8) {
            console.error('❌ Error: Password must be at least 8 characters long');
            console.log(`   Current length: ${adminPassword.length}`);
            process.exit(1);
        }
        
        // Check if password is still the default placeholder
        if (adminPassword === 'change_this_password' || adminPassword === 'change-this-password') {
            console.warn('⚠️  Warning: You are using the default password!');
            console.warn('   Please change ADMIN_PASSWORD in your .env file before seeding.');
            console.log('\nDo you want to continue anyway? (This is not recommended for production)');
            // In a real scenario, you might want to prompt the user, but for automation, we'll just warn
        }
        
        console.log('📧 Admin Email:', adminEmail);
        console.log('👤 Admin Name:', adminName || '(not provided, will use email)');
        console.log('🔒 Password: [HIDDEN]');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        // Connect to database
        console.log('🔌 Connecting to database...');
        await connectDatabase();
        console.log('✅ Database connected\n');
        
        // Check if admin already exists
        console.log('🔍 Checking if admin already exists...');
        const existingAdmin = await adminService.findAdminByEmail(adminEmail);
        
        if (existingAdmin) {
            console.log('⚠️  Admin with this email already exists!');
            console.log(`   Email: ${existingAdmin.email}`);
            console.log(`   Created: ${existingAdmin.createdAt}`);
            console.log(`   Active: ${existingAdmin.isActive ? 'Yes' : 'No'}`);
            console.log('\nTo create a new admin, use a different email address.');
            console.log('To update the existing admin, use the admin panel or delete the existing admin first.');
            
            const databaseService = require('../services/database.service');
            await databaseService.disconnect();
            process.exit(0);
        }
        
        console.log('✅ No existing admin found\n');
        
        // Create admin user
        console.log('👤 Creating admin user...');
        console.log('   (Password will be automatically hashed)');
        
        const admin = await adminService.createAdmin(adminEmail, adminPassword, adminName);
        
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ Admin user created successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📧 Email: ${admin.email}`);
        console.log(`👤 Name: ${admin.name || admin.email}`);
        console.log(`🆔 ID: ${admin._id}`);
        console.log(`✅ Active: ${admin.isActive ? 'Yes' : 'No'}`);
        console.log(`📅 Created: ${admin.createdAt}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        console.log('🔐 Security Notes:');
        console.log('   - Password has been hashed and stored securely');
        console.log('   - Never share your admin credentials');
        console.log('   - Change the default password if you used one');
        console.log('\n🔗 Login Instructions:');
        console.log(`   1. Access: /admin/login?secret=${process.env.ADMIN_SECRET_TOKEN || 'YOUR_SECRET_TOKEN'}`);
        console.log(`   2. Email: ${adminEmail}`);
        console.log(`   3. Password: [The password you set in ADMIN_PASSWORD]`);
        console.log('\n');
        
        const databaseService = require('../services/database.service');
        await databaseService.disconnect();
        console.log('✅ Database connection closed');
        console.log('\n✨ Admin seeding completed successfully!');
        
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Error seeding admin user:');
        console.error('   Message:', error.message);
        
        if (error.message.includes('already exists')) {
            console.error('\n💡 Tip: An admin with this email already exists.');
            console.error('   Use a different email or delete the existing admin first.');
        }
        
        if (error.stack && process.env.NODE_ENV === 'development') {
            console.error('\nStack trace:');
            console.error(error.stack);
        }
        
        try {
            const databaseService = require('../services/database.service');
            if (databaseService.isHealthy()) await databaseService.disconnect();
        } catch (closeError) { /* ignore */ }
        
        process.exit(1);
    }
}

// Run the seed function
seedAdmin();

