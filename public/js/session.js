/**
 * Session Management Module
 * 
 * Handles session cookies including:
 * - Session ID (for server-side session management)
 * - CSRF token (for security)
 * - User preferences (only if user consented to Preference cookies)
 * 
 * Requires cookie-utils.js to be loaded first
 */

(function () {
    'use strict';

    // Check if CookieUtils is available
    if (typeof window.CookieUtils === 'undefined') {
        console.error('[Session] CookieUtils is required. Please load cookie-utils.js first.');
        return;
    }

    const CookieUtils = window.CookieUtils;

    // Cookie names
    const SESSION_COOKIE_NAME = 'session_id';
    // CSRF_COOKIE_NAME removed - tokens are now server-generated and accessed via meta tag
    const PREFERENCES_COOKIE_NAME = 'user_preferences';

    // Cookie expiration (in days)
    const SESSION_EXPIRY_DAYS = null; // Session cookie (expires when browser closes)
    const CSRF_EXPIRY_DAYS = null; // Session cookie
    const PREFERENCES_EXPIRY_DAYS = 365; // 1 year

    /**
     * Generate a unique session ID
     * Uses cryptographically secure random number generation
     * @returns {string} - Unique session ID
     */
    function generateSessionId() {
        // Generate a cryptographically secure random session ID
        // Using 24 bytes (192 bits) for strong entropy
        const array = new Uint8Array(24);
        crypto.getRandomValues(array);
        return 'sess_' + Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Get CSRF token from server-generated meta tag
     * CSRF tokens are now generated server-side for security.
     * Client-side generation provided no protection and has been removed.
     * @returns {string|null} - CSRF token from meta tag or null if not found
     */
    function getCSRFTokenFromMeta() {
        const metaTag = document.querySelector('meta[name="csrf-token"]');
        return metaTag ? metaTag.getAttribute('content') : null;
    }

    /**
     * Initialize session ID cookie
     * This is an ESSENTIAL cookie required for site functionality and security.
     * It is set immediately without requiring consent, as documented in privacy policy.
     */
    function initSessionId() {
        // Check if session ID already exists
        let sessionId = CookieUtils.getCookie(SESSION_COOKIE_NAME);

        if (!sessionId) {
            // Generate new session ID
            sessionId = generateSessionId();

            // Set as session cookie (expires when browser closes)
            // This is an essential cookie - required for site functionality
            CookieUtils.setCookie(
                SESSION_COOKIE_NAME,
                sessionId,
                SESSION_EXPIRY_DAYS,
                {
                    secure: window.location.protocol === 'https:',
                    sameSite: 'Lax'
                }
            );

            console.log('[Session] Essential session ID cookie created');
        }

        return sessionId;
    }

    /**
     * Get CSRF token from server-generated meta tag
     * CSRF tokens are now generated server-side and embedded in the page via meta tag.
     * This provides proper security protection against CSRF attacks.
     * 
     * Note: The token is no longer stored in a client-accessible cookie.
     * It's stored server-side in the session and exposed via meta tag for client access.
     */
    function initCSRFToken() {
        // Get token from server-generated meta tag
        const csrfToken = getCSRFTokenFromMeta();

        if (!csrfToken) {
            console.warn('[Session] CSRF token not found in meta tag. Make sure the server is generating tokens.');
            return null;
        }

        // Token is available from meta tag - no need to store in cookie
        // The server stores it in the session (HttpOnly, secure)
        console.log('[Session] CSRF token loaded from server-generated meta tag');

        return csrfToken;
    }

    /**
     * Get or initialize session ID
     * @returns {string} - Session ID
     */
    function getSessionId() {
        let sessionId = CookieUtils.getCookie(SESSION_COOKIE_NAME);

        if (!sessionId) {
            sessionId = initSessionId();
        }

        return sessionId;
    }

    /**
     * Get CSRF token from server-generated meta tag
     * CSRF tokens are now generated server-side for security.
     * @returns {string|null} - CSRF token from meta tag or null if not found
     */
    function getCSRFToken() {
        // Always get from meta tag (server-generated)
        const csrfToken = getCSRFTokenFromMeta();

        if (!csrfToken) {
            console.warn('[Session] CSRF token not available. Make sure the server is generating tokens.');
        }

        return csrfToken;
    }

    /**
     * Save user preferences (only if user consented)
     * @param {object} preferences - User preferences object
     * @returns {boolean} - Success status
     */
    function saveUserPreferences(preferences) {
        // Check if user has consented to Preference cookies
        if (!CookieUtils.isCategoryAllowed(CookieUtils.COOKIE_CATEGORIES.PREFERENCES)) {
            console.warn('[Session] Cannot save preferences: User has not consented to Preference cookies');
            return false;
        }

        try {
            // Validate preferences object
            if (!preferences || typeof preferences !== 'object') {
                console.error('[Session] Invalid preferences object');
                return false;
            }

            // Store preferences as JSON string
            const preferencesString = JSON.stringify(preferences);

            // Save to cookie
            const success = CookieUtils.setCookie(
                PREFERENCES_COOKIE_NAME,
                preferencesString,
                PREFERENCES_EXPIRY_DAYS,
                {
                    secure: window.location.protocol === 'https:',
                    sameSite: 'Lax'
                }
            );

            if (success) {
                // Dispatch event for other scripts
                window.dispatchEvent(new CustomEvent('userPreferencesUpdated', {
                    detail: preferences
                }));
            }

            return success;
        } catch (error) {
            console.error('[Session] Error saving user preferences:', error);
            return false;
        }
    }

    /**
     * Get user preferences
     * @returns {object|null} - User preferences or null if not found/not consented
     */
    function getUserPreferences() {
        // Check if user has consented to Preference cookies
        if (!CookieUtils.isCategoryAllowed(CookieUtils.COOKIE_CATEGORIES.PREFERENCES)) {
            return null;
        }

        try {
            const preferencesString = CookieUtils.getCookie(PREFERENCES_COOKIE_NAME);

            if (!preferencesString) {
                return null;
            }

            return JSON.parse(preferencesString);
        } catch (error) {
            console.error('[Session] Error parsing user preferences:', error);
            // Clear corrupted preferences
            CookieUtils.deleteCookie(PREFERENCES_COOKIE_NAME);
            return null;
        }
    }

    /**
     * Update a specific preference
     * @param {string} key - Preference key
     * @param {*} value - Preference value
     * @returns {boolean} - Success status
     */
    function updatePreference(key, value) {
        const currentPreferences = getUserPreferences() || {};
        currentPreferences[key] = value;
        currentPreferences.updatedAt = new Date().toISOString();
        return saveUserPreferences(currentPreferences);
    }

    /**
     * Clear user preferences
     */
    function clearUserPreferences() {
        CookieUtils.deleteCookie(PREFERENCES_COOKIE_NAME);
        window.dispatchEvent(new CustomEvent('userPreferencesUpdated', {
            detail: null
        }));
    }

    /**
     * Initialize session management
     * Essential cookies (session) are set immediately for site security.
     * CSRF tokens are now server-generated and available via meta tag.
     * Preference cookies are only set after user consent.
     */
    function init() {
        // Essential cookies: Always initialize session ID
        // CSRF token is now server-generated and available via meta tag
        // These are necessary for site security and functionality, and are documented
        // in the privacy policy as essential cookies that don't require consent.
        initSessionId();

        // CSRF token is now server-generated - just verify it's available
        const csrfToken = initCSRFToken();
        if (!csrfToken) {
            console.warn('[Session] CSRF token not available. Some features may not work correctly.');
        }

        // Check if user has already given consent
        const hasConsent = CookieUtils.hasConsent();

        if (hasConsent) {
            // User has already consented - load preferences if available
            const preferences = getUserPreferences();
            if (preferences) {
                applyUserPreferences(preferences);
            }
        } else {
            // Wait for consent before setting preference cookies
            // Listen for consent event (will fire when user interacts with banner)
            window.addEventListener('cookieConsentUpdated', handleConsentUpdate, { once: false });
        }

        // Listen for consent changes (for when user updates preferences later)
        window.addEventListener('cookieConsentUpdated', function (event) {
            const consentData = event.detail;

            // If preferences consent was withdrawn, clear preferences
            if (!consentData.preferences) {
                clearUserPreferences();
            } else if (consentData.preferences) {
                // If preferences consent was just granted, load any saved preferences
                const preferences = getUserPreferences();
                if (preferences) {
                    applyUserPreferences(preferences);
                }
            }
        });

        console.log('[Session] Session management initialized');
    }

    /**
     * Handle initial consent update (when user first interacts with banner)
     * @param {Event} event - cookieConsentUpdated event
     */
    function handleConsentUpdate(event) {
        const consentData = event.detail;

        // If preferences consent was granted, load any saved preferences
        if (consentData && consentData.preferences) {
            const preferences = getUserPreferences();
            if (preferences) {
                applyUserPreferences(preferences);
            }
        }
    }

    /**
     * Apply user preferences to the page
     * @param {object} preferences - User preferences
     */
    function applyUserPreferences(preferences) {
        // Apply theme if set
        if (preferences.theme) {
            document.documentElement.setAttribute('data-theme', preferences.theme);
        }

        // Apply language if set
        if (preferences.language) {
            document.documentElement.setAttribute('lang', preferences.language);
        }

        // Dispatch event for other scripts to apply preferences
        window.dispatchEvent(new CustomEvent('preferencesApplied', {
            detail: preferences
        }));
    }

    /**
     * Get session information
     * @returns {object} - Session info object
     */
    function getSessionInfo() {
        return {
            sessionId: getSessionId(),
            csrfToken: getCSRFToken(),
            hasPreferences: CookieUtils.isCategoryAllowed(CookieUtils.COOKIE_CATEGORIES.PREFERENCES),
            preferences: getUserPreferences()
        };
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // DOM already loaded
        init();
    }

    // Export public API
    window.getCSRFToken = getCSRFToken; // Global access for other scripts
    window.SessionManager = {
        getSessionId,
        getCSRFToken,
        saveUserPreferences,
        getUserPreferences,
        updatePreference,
        clearUserPreferences,
        getSessionInfo,
        init
    };

})();

