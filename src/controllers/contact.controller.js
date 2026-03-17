// Contact Controller
const contactService = require('../services/contact.service');
const emailService = require('../services/email.service');
const { validateContactSubmission, sanitizeObject } = require('../utils/validators');

/**
 * Submit contact form
 * POST /api/contact
 */
exports.submitContactForm = async (req, res) => {
    try {
        // Sanitize input
        const sanitizedBody = sanitizeObject(req.body);
        
        // Validate submission data
        const validation = validateContactSubmission(sanitizedBody);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: validation.errors
            });
        }

        // Prepare submission data
        const submissionData = {
            name: sanitizedBody.name.trim(),
            email: sanitizedBody.email.trim().toLowerCase(),
            phone: sanitizedBody.phone ? sanitizedBody.phone.trim() : null,
            subject: sanitizedBody.subject,
            message: sanitizedBody.message.trim(),
            status: 'new'
        };

        // Save to database
        const submission = await contactService.createSubmission(submissionData);

        // Send emails (don't fail if email sending fails)
        const submissionObj = submission.toObject ? submission.toObject() : submission;
        try {
            await emailService.sendContactNotificationToAdmin(submissionObj);
        } catch (emailError) {
            console.error('[Contact Controller] Error sending admin notification:', emailError);
            // Continue even if email fails
        }

        try {
            await emailService.sendContactConfirmationToUser(submissionObj);
        } catch (emailError) {
            console.error('[Contact Controller] Error sending user confirmation:', emailError);
            // Continue even if email fails
        }

        console.log(`[Contact Controller] Contact form submitted: ${submission.id}`);

        res.json({
            success: true,
            message: 'Thank you for your message. We will get back to you soon!',
            submissionId: submission.id
        });
    } catch (error) {
        console.error('[Contact Controller] Error submitting contact form:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit contact form. Please try again later.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Get contact submissions (API endpoint)
 * GET /api/admin/contact-submissions
 */
exports.getContactSubmissions = async (req, res) => {
    try {
        // TODO: Add authentication middleware
        
        const { sanitizeObject } = require('../utils/validators');
        const sanitizedQuery = sanitizeObject(req.query);

        // Extract query parameters
        const page = parseInt(sanitizedQuery.page) || 1;
        const limit = parseInt(sanitizedQuery.limit) || 50;
        const skip = (page - 1) * limit;

        // Build filters
        const filters = {};
        if (sanitizedQuery.status) filters.status = sanitizedQuery.status;
        if (sanitizedQuery.subject) filters.subject = sanitizedQuery.subject;
        if (sanitizedQuery.search) filters.search = sanitizedQuery.search;
        if (sanitizedQuery.startDate) filters.startDate = sanitizedQuery.startDate;
        if (sanitizedQuery.endDate) filters.endDate = sanitizedQuery.endDate;

        // Get submissions
        const result = await contactService.getAllSubmissions(filters, { limit, skip });

        res.json({
            success: true,
            data: result.submissions,
            pagination: {
                page: result.page,
                totalPages: result.totalPages,
                total: result.total,
                limit: result.limit
            }
        });
    } catch (error) {
        console.error('[Contact Controller] Error getting submissions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch contact submissions',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Render contact submissions admin page
 * GET /admin/contact-submissions
 */
exports.renderContactSubmissionsPage = async (req, res) => {
    try {
        // TODO: Add authentication middleware
        
        // Get new submissions count for badge
        const newCount = await contactService.getNewSubmissionsCount();

        res.render('admin/contact-submissions', {
            title: 'Contact Submissions | Qualitick Collections',
            page: 'admin',
            activePage: 'contact-submissions',
            newSubmissionsCount: newCount
        });
    } catch (error) {
        console.error('[Contact Controller] Error rendering submissions page:', error);
        res.status(500).render('error', {
            title: 'Error | Qualitick Collections',
            message: 'Failed to load contact submissions page'
        });
    }
};

/**
 * Update submission status
 * PATCH /api/admin/contact-submissions/:id/status
 */
exports.updateSubmissionStatus = async (req, res) => {
    try {
        // TODO: Add authentication middleware
        
        const { id } = req.params;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Status is required'
            });
        }

        const submission = await contactService.updateSubmissionStatus(id, status);

        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found'
            });
        }

        res.json({
            success: true,
            message: 'Status updated successfully',
            submission
        });
    } catch (error) {
        console.error('[Contact Controller] Error updating submission status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update submission status',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Delete submission
 * DELETE /api/admin/contact-submissions/:id
 */
exports.deleteSubmission = async (req, res) => {
    try {
        // TODO: Add authentication middleware
        
        const { id } = req.params;

        const submission = await contactService.deleteSubmission(id);

        if (!submission) {
            return res.status(404).json({
                success: false,
                message: 'Submission not found'
            });
        }

        res.json({
            success: true,
            message: 'Submission deleted successfully'
        });
    } catch (error) {
        console.error('[Contact Controller] Error deleting submission:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete submission',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

