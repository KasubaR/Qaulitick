/**
 * Cookie Consent Banner
 * 
 * GDPR-compliant cookie consent banner with category-based consent management.
 * Requires cookie-utils.js to be loaded first.
 */

(function() {
    'use strict';

    // Check if CookieUtils is available
    if (typeof window.CookieUtils === 'undefined') {
        console.error('[Cookie Consent] CookieUtils is required. Please load cookie-utils.js first.');
        return;
    }

    const CookieUtils = window.CookieUtils;

    // Banner state
    let bannerElement = null;
    let modalElement = null;
    let isInitialized = false;

    /**
     * Initialize cookie consent banner
     */
    function init() {
        // Don't initialize twice
        if (isInitialized) {
            return;
        }

        // Check if user has already given consent
        if (CookieUtils.hasConsent()) {
            // User has already consented, don't show banner
            // But mark as initialized to prevent re-initialization
            // Also create modal in case user wants to change preferences later
            createModal();
            isInitialized = true;
            return;
        }

        // Create and show banner
        createBanner();
        showBanner();
        
        isInitialized = true;
    }

    /**
     * Create the consent banner HTML
     */
    function createBanner() {
        // Create banner container
        bannerElement = document.createElement('div');
        bannerElement.id = 'cookieConsentBanner';
        bannerElement.className = 'cookie-consent-banner';
        bannerElement.setAttribute('role', 'dialog');
        bannerElement.setAttribute('aria-labelledby', 'cookieConsentTitle');
        bannerElement.setAttribute('aria-describedby', 'cookieConsentDescription');
        bannerElement.setAttribute('aria-modal', 'false');

        bannerElement.innerHTML = `
            <div class="cookie-consent-content">
                <div class="cookie-consent-header">
                    <div class="cookie-consent-icon">
                        <i class="fas fa-cookie-bite"></i>
                    </div>
                    <div class="cookie-consent-text">
                        <h3 id="cookieConsentTitle" class="cookie-consent-title">We Value Your Privacy</h3>
                        <p id="cookieConsentDescription" class="cookie-consent-description">
                            We use cookies to enhance your browsing experience, analyze site traffic, and personalize content. 
                            By clicking "Accept All", you consent to our use of cookies. You can customize your preferences or reject non-essential cookies.
                        </p>
                    </div>
                </div>
                <div class="cookie-consent-actions">
                    <button type="button" class="cookie-btn cookie-btn-reject" id="cookieRejectBtn" aria-label="Reject all non-essential cookies">
                        <i class="fas fa-times"></i> Reject All
                    </button>
                    <button type="button" class="cookie-btn cookie-btn-customize" id="cookieCustomizeBtn" aria-label="Customize cookie preferences">
                        <i class="fas fa-cog"></i> Customize
                    </button>
                    <button type="button" class="cookie-btn cookie-btn-accept" id="cookieAcceptBtn" aria-label="Accept all cookies">
                        <i class="fas fa-check"></i> Accept All
                    </button>
                </div>
            </div>
        `;

        // Create modal for detailed preferences
        createModal();

        // Append to body first (so getElementById works)
        document.body.appendChild(bannerElement);
        document.body.appendChild(modalElement);

        // Add event listeners after elements are in DOM
        setupEventListeners();
    }

    /**
     * Create the customization modal
     */
    function createModal() {
        modalElement = document.createElement('div');
        modalElement.id = 'cookieConsentModal';
        modalElement.className = 'cookie-consent-modal';
        modalElement.setAttribute('role', 'dialog');
        modalElement.setAttribute('aria-labelledby', 'cookieModalTitle');
        modalElement.setAttribute('aria-modal', 'true');
        modalElement.setAttribute('aria-hidden', 'true');

        modalElement.innerHTML = `
            <div class="cookie-consent-modal-overlay"></div>
            <div class="cookie-consent-modal-content">
                <div class="cookie-consent-modal-header">
                    <h2 id="cookieModalTitle" class="cookie-consent-modal-title">Cookie Preferences</h2>
                    <button type="button" class="cookie-consent-modal-close" id="cookieModalCloseBtn" aria-label="Close cookie preferences">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="cookie-consent-modal-body">
                    <p class="cookie-consent-modal-intro">
                        Choose which cookies you want to accept. Essential cookies are required for the website to function properly.
                    </p>
                    
                    <div class="cookie-category">
                        <div class="cookie-category-header">
                            <div class="cookie-category-info">
                                <h3 class="cookie-category-title">Essential Cookies</h3>
                                <p class="cookie-category-description">
                                    Required for the website to function. These cookies cannot be disabled.
                                </p>
                            </div>
                            <div class="cookie-category-toggle">
                                <input type="checkbox" id="cookieEssential" checked disabled aria-label="Essential cookies (always enabled)">
                                <label for="cookieEssential" class="cookie-toggle-label">
                                    <span class="cookie-toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                        <ul class="cookie-category-list">
                            <li>Session management</li>
                            <li>Security (CSRF protection)</li>
                            <li>Cookie consent preferences</li>
                        </ul>
                    </div>

                    <div class="cookie-category">
                        <div class="cookie-category-header">
                            <div class="cookie-category-info">
                                <h3 class="cookie-category-title">Analytics Cookies</h3>
                                <p class="cookie-category-description">
                                    Help us understand how visitors interact with our website by collecting anonymous information.
                                </p>
                            </div>
                            <div class="cookie-category-toggle">
                                <input type="checkbox" id="cookieAnalytics" aria-label="Enable analytics cookies">
                                <label for="cookieAnalytics" class="cookie-toggle-label">
                                    <span class="cookie-toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                        <ul class="cookie-category-list">
                            <li>Google Analytics</li>
                            <li>Page views and user behavior</li>
                            <li>Traffic sources and demographics</li>
                        </ul>
                    </div>

                    <div class="cookie-category">
                        <div class="cookie-category-header">
                            <div class="cookie-category-info">
                                <h3 class="cookie-category-title">Preference Cookies</h3>
                                <p class="cookie-category-description">
                                    Remember your preferences and settings to provide a personalized experience.
                                </p>
                            </div>
                            <div class="cookie-category-toggle">
                                <input type="checkbox" id="cookiePreferences" aria-label="Enable preference cookies">
                                <label for="cookiePreferences" class="cookie-toggle-label">
                                    <span class="cookie-toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                        <ul class="cookie-category-list">
                            <li>Filter preferences</li>
                            <li>Theme and display settings</li>
                            <li>Language preferences</li>
                        </ul>
                    </div>
                </div>
                <div class="cookie-consent-modal-footer">
                    <button type="button" class="cookie-btn cookie-btn-secondary" id="cookieModalCancelBtn">
                        Cancel
                    </button>
                    <button type="button" class="cookie-btn cookie-btn-primary" id="cookieModalSaveBtn">
                        Save Preferences
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        if (!bannerElement || !modalElement) {
            console.error('[Cookie Consent] Cannot setup event listeners: banner or modal element is missing');
            return;
        }

        // Accept All button
        const acceptBtn = bannerElement.querySelector('#cookieAcceptBtn');
        if (acceptBtn) {
            acceptBtn.addEventListener('click', handleAcceptAll);
        } else {
            console.warn('[Cookie Consent] Accept button not found');
        }

        // Reject All button
        const rejectBtn = bannerElement.querySelector('#cookieRejectBtn');
        if (rejectBtn) {
            rejectBtn.addEventListener('click', handleRejectAll);
        } else {
            console.warn('[Cookie Consent] Reject button not found');
        }

        // Customize button
        const customizeBtn = bannerElement.querySelector('#cookieCustomizeBtn');
        if (customizeBtn) {
            console.log('[Cookie Consent] Customize button found, adding event listener');
            customizeBtn.addEventListener('click', handleCustomize);
        } else {
            console.error('[Cookie Consent] Customize button not found!');
        }

        // Modal close button
        const modalCloseBtn = modalElement.querySelector('#cookieModalCloseBtn');
        if (modalCloseBtn) {
            modalCloseBtn.addEventListener('click', handleModalClose);
        } else {
            console.warn('[Cookie Consent] Modal close button not found');
        }

        // Modal cancel button
        const modalCancelBtn = modalElement.querySelector('#cookieModalCancelBtn');
        if (modalCancelBtn) {
            modalCancelBtn.addEventListener('click', handleModalClose);
        } else {
            console.warn('[Cookie Consent] Modal cancel button not found');
        }

        // Modal save button
        const modalSaveBtn = modalElement.querySelector('#cookieModalSaveBtn');
        if (modalSaveBtn) {
            modalSaveBtn.addEventListener('click', handleSavePreferences);
        } else {
            console.warn('[Cookie Consent] Modal save button not found');
        }

        // Close modal on overlay click
        const modalOverlay = modalElement.querySelector('.cookie-consent-modal-overlay');
        if (modalOverlay) {
            modalOverlay.addEventListener('click', handleModalClose);
        } else {
            console.warn('[Cookie Consent] Modal overlay not found');
        }

        // Keyboard navigation
        document.addEventListener('keydown', handleKeyboardNavigation);
    }

    /**
     * Handle Accept All button click
     */
    function handleAcceptAll() {
        const preferences = {
            essential: true,
            analytics: true,
            preferences: true
        };

        saveConsent(preferences);
        hideBanner();
    }

    /**
     * Handle Reject All button click
     */
    function handleRejectAll() {
        const preferences = {
            essential: true,
            analytics: false,
            preferences: false
        };

        saveConsent(preferences);
        hideBanner();
    }

    /**
     * Handle Customize button click
     */
    function handleCustomize() {
        console.log('[Cookie Consent] Customize button clicked');
        console.log('[Cookie Consent] Modal element exists:', !!modalElement);
        if (!modalElement) {
            console.error('[Cookie Consent] Modal element not found! Creating modal...');
            createModal();
        }
        showModal();
    }

    /**
     * Handle Save Preferences button click
     */
    function handleSavePreferences() {
        const preferences = {
            essential: true, // Always true
            analytics: document.getElementById('cookieAnalytics')?.checked || false,
            preferences: document.getElementById('cookiePreferences')?.checked || false
        };

        saveConsent(preferences);
        hideModal();
        hideBanner();
    }

    /**
     * Handle modal close
     */
    function handleModalClose() {
        hideModal();
    }

    /**
     * Handle keyboard navigation
     */
    function handleKeyboardNavigation(event) {
        // Close modal on Escape key
        if (event.key === 'Escape' && modalElement && modalElement.classList.contains('active')) {
            hideModal();
        }

        // Trap focus within modal when open
        if (event.key === 'Tab' && modalElement && modalElement.classList.contains('active')) {
            trapFocus(event, modalElement);
        }
    }

    /**
     * Trap focus within modal for accessibility
     */
    function trapFocus(event, modal) {
        const focusableElements = modal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey) {
            if (document.activeElement === firstElement) {
                event.preventDefault();
                lastElement.focus();
            }
        } else {
            if (document.activeElement === lastElement) {
                event.preventDefault();
                firstElement.focus();
            }
        }
    }

    /**
     * Save consent preferences
     */
    function saveConsent(preferences) {
        const success = CookieUtils.setConsentPreferences(preferences);

        if (success) {
            // Clear cookies independently based on revoked consent
            // Clear analytics cookies if analytics consent is revoked
            if (!preferences.analytics) {
                CookieUtils.clearAnalyticsCookies();
            }
            
            // Clear preference cookies if preference consent is revoked
            if (!preferences.preferences) {
                CookieUtils.clearPreferenceCookies();
            }

            // Show success notification if available
            if (typeof showNotification === 'function') {
                showNotification('Cookie preferences saved successfully.');
            }
        } else {
            console.error('[Cookie Consent] Failed to save consent preferences');
            if (typeof showNotification === 'function') {
                showNotification('Failed to save preferences. Please try again.', 'error');
            }
        }
    }

    /**
     * Show banner
     */
    function showBanner() {
        if (bannerElement) {
            bannerElement.classList.add('active');
            // Focus first button for accessibility
            setTimeout(() => {
                const firstButton = bannerElement.querySelector('button');
                if (firstButton) {
                    firstButton.focus();
                }
            }, 100);
        }
    }

    /**
     * Hide banner
     */
    function hideBanner() {
        if (bannerElement) {
            bannerElement.classList.remove('active');
            setTimeout(() => {
                if (bannerElement && bannerElement.parentNode) {
                    bannerElement.parentNode.removeChild(bannerElement);
                }
                bannerElement = null;
            }, 300); // Wait for animation
        }
        
        // Clean up modal element and keyboard listener
        if (modalElement) {
            if (modalElement.parentNode) {
                modalElement.parentNode.removeChild(modalElement);
            }
            modalElement = null;
        }
        
        // Remove keyboard event listener
        document.removeEventListener('keydown', handleKeyboardNavigation);
    }

    /**
     * Show modal
     */
    function showModal() {
        console.log('[Cookie Consent] showModal called, modalElement:', modalElement);
        if (modalElement) {
            console.log('[Cookie Consent] Adding active class to modal');
            modalElement.classList.add('active');
            modalElement.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden'; // Prevent background scrolling
            
            // Focus first focusable element
            setTimeout(() => {
                const firstFocusable = modalElement.querySelector('button, input');
                if (firstFocusable) {
                    firstFocusable.focus();
                }
            }, 100);
        } else {
            console.error('[Cookie Consent] Cannot show modal: modalElement is null');
        }
    }

    /**
     * Hide modal
     */
    function hideModal() {
        if (modalElement) {
            modalElement.classList.remove('active');
            modalElement.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = ''; // Restore scrolling
        }
    }

    /**
     * Public API: Show consent banner again (for settings page)
     */
    function showConsentBanner() {
        if (!CookieUtils.hasConsent()) {
            init();
        } else {
            // User has consented - show modal for preference changes
            // Ensure modal exists (it should have been created in init(), but create if missing)
            if (!modalElement) {
                createModal();
                document.body.appendChild(modalElement);
            }
            showModal();
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // DOM already loaded
        init();
    }

    // Export public API
    window.CookieConsent = {
        show: showConsentBanner,
        hide: hideBanner,
        showModal: showModal,
        hideModal: hideModal
    };

})();

