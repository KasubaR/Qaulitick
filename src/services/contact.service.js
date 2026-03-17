const { Op } = require('sequelize');
const ContactSubmission = require('../models/ContactSubmission.model');

/**
 * Contact Service
 *
 * Handles all database operations for contact submissions
 */

class ContactService {

    async createSubmission(submissionData) {
        try {
            const submission = await ContactSubmission.create(submissionData);
            return submission;
        } catch (error) {
            console.error('[Contact Service] Error creating submission:', error);
            throw error;
        }
    }

    async getAllSubmissions(filters = {}, options = {}) {
        try {
            const { limit = 50, skip = 0 } = options;

            const where = {};
            if (filters.status) where.status = filters.status;
            if (filters.subject) where.subject = filters.subject;
            if (filters.search) {
                where[Op.or] = [
                    { name: { [Op.like]: `%${filters.search}%` } },
                    { email: { [Op.like]: `%${filters.search}%` } },
                    { message: { [Op.like]: `%${filters.search}%` } }
                ];
            }
            if (filters.startDate || filters.endDate) {
                where.createdAt = {};
                if (filters.startDate) where.createdAt[Op.gte] = new Date(filters.startDate);
                if (filters.endDate) where.createdAt[Op.lte] = new Date(filters.endDate);
            }

            const { count: total, rows: submissions } = await ContactSubmission.findAndCountAll({
                where,
                order: [['createdAt', 'DESC']],
                limit,
                offset: skip
            });

            return {
                submissions,
                total,
                page: Math.floor(skip / limit) + 1,
                totalPages: Math.ceil(total / limit),
                limit
            };
        } catch (error) {
            console.error('[Contact Service] Error getting submissions:', error);
            throw error;
        }
    }

    async getSubmissionById(id) {
        try {
            return await ContactSubmission.findByPk(id);
        } catch (error) {
            console.error('[Contact Service] Error getting submission by ID:', error);
            throw error;
        }
    }

    async updateSubmissionStatus(id, status) {
        try {
            const validStatuses = ['new', 'replied', 'archived'];
            if (!validStatuses.includes(status)) {
                throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
            }

            const submission = await ContactSubmission.findByPk(id);
            if (!submission) return null;

            await submission.update({ status });
            return submission;
        } catch (error) {
            console.error('[Contact Service] Error updating submission status:', error);
            throw error;
        }
    }

    async deleteSubmission(id) {
        try {
            const submission = await ContactSubmission.findByPk(id);
            if (!submission) return null;

            await submission.destroy();
            return submission;
        } catch (error) {
            console.error('[Contact Service] Error deleting submission:', error);
            throw error;
        }
    }

    async getNewSubmissionsCount() {
        try {
            return await ContactSubmission.count({ where: { status: 'new' } });
        } catch (error) {
            console.error('[Contact Service] Error getting new submissions count:', error);
            throw error;
        }
    }
}

module.exports = new ContactService();
