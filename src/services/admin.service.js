const bcrypt = require('bcrypt');
const Admin = require('../models/Admin.model');

// Pre-computed dummy hash used to keep response time constant when no admin
// is found for the submitted email, preventing email enumeration via timing.
const DUMMY_HASH = '$2b$10$invalidhashfortimingsafetynormXXXXXXXXXXXXXXXXXXXX';

/**
 * Admin Service
 * 
 * Handles all database operations and authentication logic for admin users
 */

class AdminService {
    
    /**
     * Create new admin user with hashed password
     * Password will be automatically hashed by the Admin model's pre-save hook
     * @param {string} email - Admin email address
     * @param {string} password - Plain text password (will be hashed)
     * @param {string} name - Admin name (optional)
     * @returns {Promise<Object>} Created admin user (password excluded)
     */
    async createAdmin(email, password, name = null) {
        try {
            // Check if admin with this email already exists
            const existingAdmin = await Admin.findOne({
                where: { email: email.toLowerCase() }
            });
            if (existingAdmin) {
                throw new Error('Admin with this email already exists');
            }

            // Create new admin
            const adminData = {
                email: email.toLowerCase(),
                password: password,
                isActive: true
            };

            if (name) {
                adminData.name = name;
            }

            const admin = await Admin.create(adminData);

            return admin.toJSON();
        } catch (error) {
            console.error('[Admin Service] Error creating admin:', error);
            throw error;
        }
    }

    /**
     * Find admin by email
     * @param {string} email - Admin email address
     * @returns {Promise<Object|null>} Admin user or null if not found
     */
    async findAdminByEmail(email) {
        try {
            const admin = await Admin.findOne({
                where: {
                    email: email.toLowerCase(),
                    isActive: true
                }
            });
            return admin;
        } catch (error) {
            console.error('[Admin Service] Error finding admin by email:', error);
            throw error;
        }
    }

    /**
     * Validate admin credentials (email and password)
     * @param {string} email - Admin email address
     * @param {string} password - Plain text password to validate
     * @returns {Promise<Object|null>} Admin user if credentials are valid, null otherwise
     */
    async validateAdminCredentials(email, password) {
        try {
            const admin = await this.findAdminByEmail(email);

            // Always run bcrypt regardless of whether the admin exists.
            // Returning early on a missing email leaks its existence via response
            // timing (~0ms vs ~100ms for a real bcrypt comparison).
            const isPasswordValid = admin
                ? await admin.comparePassword(password)
                : await bcrypt.compare(password, DUMMY_HASH);

            if (!admin || !isPasswordValid) {
                return null;
            }

            return admin.toJSON();
        } catch (error) {
            console.error('[Admin Service] Error validating admin credentials:', error);
            throw error;
        }
    }

    /**
     * Update last login timestamp for admin
     * @param {string} adminId - Admin document ID
     * @returns {Promise<void>}
     */
    async updateLastLogin(adminId) {
        try {
            await Admin.findByIdAndUpdate(
                adminId,
                { lastLogin: new Date() },
                { new: true, runValidators: false }
            );
        } catch (error) {
            console.error('[Admin Service] Error updating last login:', error);
            throw error;
        }
    }

    /**
     * Get admin by ID
     * @param {string} adminId - Admin document ID
     * @returns {Promise<Object|null>} Admin user or null if not found
     */
    async getAdminById(adminId) {
        try {
            const admin = await Admin.findByPk(adminId);
            if (!admin || !admin.isActive) {
                return null;
            }
            
            return admin.toJSON();
        } catch (error) {
            console.error('[Admin Service] Error getting admin by ID:', error);
            throw error;
        }
    }

    /**
     * Check if admin exists by email
     * @param {string} email - Admin email address
     * @returns {Promise<boolean>} True if admin exists, false otherwise
     */
    async adminExists(email) {
        try {
            const admin = await Admin.findOne({
                where: { email: email.toLowerCase() }
            });
            return !!admin;
        } catch (error) {
            console.error('[Admin Service] Error checking if admin exists:', error);
            throw error;
        }
    }
}

// Export singleton instance
module.exports = new AdminService();

