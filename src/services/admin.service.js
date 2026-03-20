const Admin = require('../models/Admin.model');

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

            const admin = new Admin(adminData);
            await admin.save();

            // Return admin without password
            const adminObj = admin.toJSON();
            delete adminObj.password;
            return adminObj;
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
            // Find admin by email
            const admin = await this.findAdminByEmail(email);
            
            if (!admin) {
                // Admin not found or inactive
                return null;
            }

            // Compare password using the model's comparePassword method
            const isPasswordValid = await admin.comparePassword(password);
            
            if (!isPasswordValid) {
                // Password doesn't match
                return null;
            }

            // Credentials are valid, return admin (password excluded)
            const adminObj = admin.toJSON();
            delete adminObj.password;
            return adminObj;
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
            
            // Return admin without password
            const adminObj = admin.toJSON();
            delete adminObj.password;
            return adminObj;
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

