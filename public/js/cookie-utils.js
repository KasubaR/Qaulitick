/**
 * Cookie Utility Module
 * 
 * Provides cookie management functions with GDPR compliance support.
 * Handles cookie consent preferences and category-based cookie management.
 */

// Cookie consent categories
const COOKIE_CATEGORIES = {
    ESSENTIAL: 'essential',
    ANALYTICS: 'analytics',
    PREFERENCES: 'preferences'
};

// Cookie consent storage key
const CONSENT_COOKIE_NAME = 'cookie_consent';
const CONSENT_COOKIE_EXPIRY_DAYS = 365; // Store consent for 1 year

/**
 * Set a cookie with optional expiration and attributes
 * @param {string} name - Cookie name
 * @param {string} value - Cookie value
 * @param {number} days - Days until expiration (default: session cookie)
 * @param {object} options - Additional cookie options
 * @param {string} options.path - Cookie path (default: '/')
 * @param {string} options.domain - Cookie domain
 * @param {boolean} options.secure - Secure flag (HTTPS only)
 * @param {string} options.sameSite - SameSite attribute ('Strict', 'Lax', 'None')
 * @returns {boolean} - Success status
 */
function setCookie(name, value, days = null, options = {}) {
    try {
        // Default options
        const defaultOptions = {
            path: '/',
            secure: window.location.protocol === 'https:',
            sameSite: 'Lax'
        };
        
        const cookieOptions = { ...defaultOptions, ...options };
        
        // Build cookie string
        let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
        
        // Add expiration
        if (days !== null && days !== undefined) {
            const expirationDate = new Date();
            expirationDate.setTime(expirationDate.getTime() + (days * 24 * 60 * 60 * 1000));
            cookieString += `; expires=${expirationDate.toUTCString()}`;
        }
        
        // Add path
        cookieString += `; path=${cookieOptions.path}`;
        
        // Add domain if specified
        if (cookieOptions.domain) {
            cookieString += `; domain=${cookieOptions.domain}`;
        }
        
        // Add secure flag
        if (cookieOptions.secure) {
            cookieString += '; Secure';
        }
        
        // Add SameSite attribute
        if (cookieOptions.sameSite) {
            cookieString += `; SameSite=${cookieOptions.sameSite}`;
        }
        
        // Set the cookie
        document.cookie = cookieString;
        
        // Verify cookie was set (for same-origin cookies)
        if (getCookie(name) === value) {
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('[Cookie Utils] Error setting cookie:', error);
        return false;
    }
}

/**
 * Get a cookie value by name
 * @param {string} name - Cookie name
 * @returns {string|null} - Cookie value or null if not found
 */
function getCookie(name) {
    try {
        const encodedName = encodeURIComponent(name);
        const cookies = document.cookie.split(';');
        
        for (let i = 0; i < cookies.length; i++) {
            let cookie = cookies[i].trim();
            
            // Check if this cookie matches
            if (cookie.indexOf(encodedName + '=') === 0) {
                const value = cookie.substring(encodedName.length + 1);
                return decodeURIComponent(value);
            }
        }
        
        return null;
    } catch (error) {
        console.error('[Cookie Utils] Error getting cookie:', error);
        return null;
    }
}

/**
 * Delete a cookie
 * @param {string} name - Cookie name
 * @param {object} options - Cookie options (path, domain)
 * @returns {boolean} - Success status
 */
function deleteCookie(name, options = {}) {
    try {
        // Set cookie with expiration in the past
        const defaultOptions = {
            path: '/',
            expires: new Date(0).toUTCString()
        };
        
        const cookieOptions = { ...defaultOptions, ...options };
        
        let cookieString = `${encodeURIComponent(name)}=; expires=${cookieOptions.expires}`;
        cookieString += `; path=${cookieOptions.path}`;
        
        if (cookieOptions.domain) {
            cookieString += `; domain=${cookieOptions.domain}`;
        }
        
        document.cookie = cookieString;
        
        // Verify cookie was deleted
        return getCookie(name) === null;
    } catch (error) {
        console.error('[Cookie Utils] Error deleting cookie:', error);
        return false;
    }
}

/**
 * Check if user has given consent for cookies
 * @returns {boolean} - True if consent has been given
 */
function hasConsent() {
    const consent = getCookie(CONSENT_COOKIE_NAME);
    return consent !== null && consent !== '';
}

/**
 * Get detailed consent preferences
 * @returns {object|null} - Consent preferences object or null if no consent
 */
function getConsentPreferences() {
    try {
        const consentData = getCookie(CONSENT_COOKIE_NAME);
        
        if (!consentData) {
            return null;
        }
        
        // Parse consent data (stored as JSON)
        const preferences = JSON.parse(consentData);
        
        // Ensure all categories are present with defaults
        return {
            essential: preferences.essential !== false, // Always true (required)
            analytics: preferences.analytics === true,
            preferences: preferences.preferences === true,
            timestamp: preferences.timestamp || null,
            version: preferences.version || '1.0'
        };
    } catch (error) {
        console.error('[Cookie Utils] Error parsing consent preferences:', error);
        return null;
    }
}

/**
 * Set consent preferences
 * @param {object} preferences - Consent preferences object
 * @param {boolean} preferences.essential - Essential cookies (always true)
 * @param {boolean} preferences.analytics - Analytics cookies consent
 * @param {boolean} preferences.preferences - Preference cookies consent
 * @returns {boolean} - Success status
 */
function setConsentPreferences(preferences) {
    try {
        // Validate preferences object
        if (!preferences || typeof preferences !== 'object') {
            console.error('[Cookie Utils] Invalid preferences object');
            return false;
        }
        
        // Ensure essential is always true (required for site functionality)
        const consentData = {
            essential: true, // Always required
            analytics: preferences.analytics === true,
            preferences: preferences.preferences === true,
            timestamp: new Date().toISOString(),
            version: '1.0'
        };
        
        // Store as JSON string in cookie
        const consentString = JSON.stringify(consentData);
        
        // Set cookie with 1 year expiration
        const success = setCookie(
            CONSENT_COOKIE_NAME,
            consentString,
            CONSENT_COOKIE_EXPIRY_DAYS,
            {
                secure: window.location.protocol === 'https:',
                sameSite: 'Lax'
            }
        );
        
        if (success) {
            // Dispatch event for other scripts to listen to
            window.dispatchEvent(new CustomEvent('cookieConsentUpdated', {
                detail: consentData
            }));
        }
        
        return success;
    } catch (error) {
        console.error('[Cookie Utils] Error setting consent preferences:', error);
        return false;
    }
}

/**
 * Check if a specific cookie category is allowed
 * @param {string} category - Cookie category (essential, analytics, preferences)
 * @returns {boolean} - True if category is allowed
 */
function isCategoryAllowed(category) {
    // Essential cookies are always allowed
    if (category === COOKIE_CATEGORIES.ESSENTIAL) {
        return true;
    }
    
    // Check if user has given consent
    if (!hasConsent()) {
        return false;
    }
    
    // Get consent preferences
    const preferences = getConsentPreferences();
    if (!preferences) {
        return false;
    }
    
    // Check specific category
    switch (category) {
        case COOKIE_CATEGORIES.ANALYTICS:
            return preferences.analytics === true;
        case COOKIE_CATEGORIES.PREFERENCES:
            return preferences.preferences === true;
        default:
            return false;
    }
}

/**
 * Clear analytics cookies (Google Analytics cookies)
 * @returns {number} - Number of cookies deleted
 */
function clearAnalyticsCookies() {
    try {
        let deletedCount = 0;
        const analyticsCookiePatterns = [
            '_ga',      // Google Analytics main cookie
            '_gid',     // Google Analytics ID cookie
            '_gat',     // Google Analytics throttle cookie
            '_ga_'      // Google Analytics 4 measurement ID cookies (prefix)
        ];
        
        const cookies = document.cookie.split(';');
        
        cookies.forEach(cookie => {
            const trimmedCookie = cookie.trim();
            const eqIndex = trimmedCookie.indexOf('=');
            
            if (eqIndex !== -1) {
                const cookieName = decodeURIComponent(trimmedCookie.substring(0, eqIndex));
                
                // Check if cookie matches any analytics pattern
                const isAnalyticsCookie = analyticsCookiePatterns.some(pattern => {
                    return cookieName === pattern || cookieName.startsWith(pattern);
                });
                
                if (isAnalyticsCookie) {
                    if (deleteCookie(cookieName)) {
                        deletedCount++;
                    }
                }
            }
        });
        
        return deletedCount;
    } catch (error) {
        console.error('[Cookie Utils] Error clearing analytics cookies:', error);
        return 0;
    }
}

/**
 * Clear preference cookies
 * @returns {number} - Number of cookies deleted
 */
function clearPreferenceCookies() {
    try {
        let deletedCount = 0;
        const preferenceCookieNames = [
            'user_preferences' // User preferences cookie
        ];
        
        preferenceCookieNames.forEach(cookieName => {
            if (deleteCookie(cookieName)) {
                deletedCount++;
            }
        });
        
        return deletedCount;
    } catch (error) {
        console.error('[Cookie Utils] Error clearing preference cookies:', error);
        return 0;
    }
}

/**
 * Clear all non-essential cookies (when user withdraws consent)
 * @param {string[]} essentialCookieNames - Array of essential cookie names to preserve
 * @returns {number} - Number of cookies deleted
 */
function clearNonEssentialCookies(essentialCookieNames = [CONSENT_COOKIE_NAME]) {
    try {
        let deletedCount = 0;
        const cookies = document.cookie.split(';');
        
        cookies.forEach(cookie => {
            const trimmedCookie = cookie.trim();
            const eqIndex = trimmedCookie.indexOf('=');
            
            if (eqIndex !== -1) {
                const cookieName = decodeURIComponent(trimmedCookie.substring(0, eqIndex));
                
                // Skip essential cookies
                if (essentialCookieNames.includes(cookieName)) {
                    return;
                }
                
                // Delete the cookie
                if (deleteCookie(cookieName)) {
                    deletedCount++;
                }
            }
        });
        
        return deletedCount;
    } catch (error) {
        console.error('[Cookie Utils] Error clearing non-essential cookies:', error);
        return 0;
    }
}

/**
 * Get all cookies as an object
 * @returns {object} - Object with cookie names as keys and values as values
 */
function getAllCookies() {
    try {
        const cookies = {};
        const cookieStrings = document.cookie.split(';');
        
        cookieStrings.forEach(cookieString => {
            const trimmedCookie = cookieString.trim();
            const eqIndex = trimmedCookie.indexOf('=');
            
            // Only process if we found an equals sign
            if (eqIndex !== -1) {
                const name = decodeURIComponent(trimmedCookie.substring(0, eqIndex));
                const value = decodeURIComponent(trimmedCookie.substring(eqIndex + 1));
                cookies[name] = value;
            }
        });
        
        return cookies;
    } catch (error) {
        console.error('[Cookie Utils] Error getting all cookies:', error);
        return {};
    }
}

// Export functions for use in other scripts
if (typeof window !== 'undefined') {
    window.CookieUtils = {
        setCookie,
        getCookie,
        deleteCookie,
        hasConsent,
        getConsentPreferences,
        setConsentPreferences,
        isCategoryAllowed,
        clearAnalyticsCookies,
        clearPreferenceCookies,
        clearNonEssentialCookies,
        getAllCookies,
        COOKIE_CATEGORIES,
        CONSENT_COOKIE_NAME
    };
}

// Also export for ES6 modules if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        setCookie,
        getCookie,
        deleteCookie,
        hasConsent,
        getConsentPreferences,
        setConsentPreferences,
        isCategoryAllowed,
        clearAnalyticsCookies,
        clearPreferenceCookies,
        clearNonEssentialCookies,
        getAllCookies,
        COOKIE_CATEGORIES,
        CONSENT_COOKIE_NAME
    };
}

