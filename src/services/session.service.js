const { sequelize } = require('../config/mysql');
const logger = require('../utils/logger').child({ module: 'SessionService' });

/**
 * Delete all sessions for a given userId from the Sessions table.
 * Uses MySQL JSON_EXTRACT to match the userId stored in the session data column.
 *
 * @param {number} userId
 * @param {string|null} [excludeSid] - Session ID to keep (e.g. the caller's current session)
 */
async function deleteAllSessionsForUser(userId, excludeSid = null) {
    try {
        const numericId = Number(userId);
        if (!Number.isFinite(numericId) || numericId <= 0) return;

        if (excludeSid) {
            await sequelize.query(
                'DELETE FROM `Sessions` WHERE JSON_EXTRACT(`data`, \'$.userId\') = :userId AND `sid` != :sid',
                { replacements: { userId: numericId, sid: excludeSid } }
            );
        } else {
            await sequelize.query(
                'DELETE FROM `Sessions` WHERE JSON_EXTRACT(`data`, \'$.userId\') = :userId',
                { replacements: { userId: numericId } }
            );
        }
    } catch (err) {
        logger.error({ err, userId }, 'deleteAllSessionsForUser failed');
    }
}

module.exports = { deleteAllSessionsForUser };
