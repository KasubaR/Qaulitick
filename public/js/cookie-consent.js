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
    let keyboardListenerAttached = false;

    /**
     * Initialize cookie consent banner
     */
    function init() {
        // Don't initialize twice
        if (isInitialized) {
            return;
        }

        // Check if user has already given (current-version) consent
        if (CookieUtils.hasConsent()) {
            // User has already consented, don't show banner.
            // Mount the modal (hidden) so it's ready if the visitor reopens
            // preferences later via the footer "Cookie Settings" link.
            mountModal();
            isInitialized = true;
            return;
        }

        // Create and show banner
        createBanner();
        showBanner();

        isInitialized = true;
    }

    /**
     * Ensure the modal exists and is attached to the DOM, with its listeners wired.
     * Safe to call repeatedly - no-ops if already mounted.
     */
    function mountModal() {
        if (modalElement && modalElement.parentNode) {
            return;
        }
        createModal();
        document.body.appendChild(modalElement);
        setupModalEventListeners();
        attachKeyboardListener();
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

        // Append to body first (so getElementById works)
        document.body.appendChild(bannerElement);

        // Add event listeners after elements are in DOM
        setupBannerEventListeners();

        // Modal is mounted (created + appended + its own listeners wired) separately
        // so it works whether or not a banner is showing (e.g. reopened via "Cookie Settings").
        mountModal();
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
     * Setup banner button listeners (Accept / Reject / Customize)
     */
    function setupBannerEventListeners() {
        if (!bannerElement) {
            console.error('[Cookie Consent] Cannot setup banner listeners: banner element is missing');
            return;
        }

        const acceptBtn = bannerElement.querySelector('#cookieAcceptBtn');
        if (acceptBtn) acceptBtn.addEventListener('click', handleAcceptAll);

        const rejectBtn = bannerElement.querySelector('#cookieRejectBtn');
        if (rejectBtn) rejectBtn.addEventListener('click', handleRejectAll);

        const customizeBtn = bannerElement.querySelector('#cookieCustomizeBtn');
        if (customizeBtn) customizeBtn.addEventListener('click', handleCustomize);
    }

    /**
     * Setup modal button listeners (Close / Cancel / Save / overlay click).
     * Wired independently of the banner so the modal also works when it's
     * reopened on its own (e.g. via the footer "Cookie Settings" link) with no banner present.
     */
    function setupModalEventListeners() {
        if (!modalElement) {
            console.error('[Cookie Consent] Cannot setup modal listeners: modal element is missing');
            return;
        }

        const modalCloseBtn = modalElement.querySelector('#cookieModalCloseBtn');
        if (modalCloseBtn) modalCloseBtn.addEventListener('click', handleModalClose);

        const modalCancelBtn = modalElement.querySelector('#cookieModalCancelBtn');
        if (modalCancelBtn) modalCancelBtn.addEventListener('click', handleModalClose);

        const modalSaveBtn = modalElement.querySelector('#cookieModalSaveBtn');
        if (modalSaveBtn) modalSaveBtn.addEventListener('click', handleSavePreferences);

        const modalOverlay = modalElement.querySelector('.cookie-consent-modal-overlay');
        if (modalOverlay) modalOverlay.addEventListener('click', handleModalClose);
    }

    /**
     * Attach the global keydown handler (Escape to close, Tab to trap focus) once.
     * Not tied to banner/modal creation so it keeps working across re-opens.
     */
    function attachKeyboardListener() {
        if (keyboardListenerAttached) return;
        document.addEventListener('keydown', handleKeyboardNavigation);
        keyboardListenerAttached = true;
    }

    /**
     * Reflect the currently stored consent preferences (if any) onto the modal's checkboxes,
     * so reopening "Customize" shows what was actually chosen instead of always defaulting to unchecked.
     */
    function syncModalCheckboxesFromConsent() {
        if (!modalElement) return;
        const preferences = CookieUtils.getConsentPreferences();
        const analyticsCheckbox = modalElement.querySelector('#cookieAnalytics');
        const preferencesCheckbox = modalElement.querySelector('#cookiePreferences');
        if (analyticsCheckbox) analyticsCheckbox.checked = !!(preferences && preferences.analytics);
        if (preferencesCheckbox) preferencesCheckbox.checked = !!(preferences && preferences.preferences);
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
        mountModal();
        syncModalCheckboxesFromConsent();
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
        // The modal is left mounted (just hidden, no 'active' class) so it stays ready
        // for later reopening via the footer "Cookie Settings" link without a remount step.
    }

    /**
     * Show modal
     */
    function showModal() {
        if (modalElement) {
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
     * Public API: Reopen cookie preferences (used by the footer "Cookie Settings" link)
     */
    function showConsentBanner() {
        if (!CookieUtils.hasConsent()) {
            // No valid consent yet (or it expired / was recorded under an older
            // CONSENT_COOKIE_VERSION) - show the full banner instead of just the modal.
            isInitialized = false;
            init();
            return;
        }
        // Already consented - reopen the preferences modal, pre-filled with current choices.
        mountModal();
        syncModalCheckboxesFromConsent();
        showModal();
    }

    /**
     * Wire up the footer "Cookie Settings" link to reopen preferences.
     */
    function setupSettingsLink() {
        const settingsLink = document.getElementById('cookieSettingsLink');
        if (settingsLink) {
            settingsLink.addEventListener('click', function(event) {
                event.preventDefault();
                showConsentBanner();
            });
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            init();
            setupSettingsLink();
        });
    } else {
        // DOM already loaded
        init();
        setupSettingsLink();
    }

    // Export public API
    window.CookieConsent = {
        show: showConsentBanner,
        hide: hideBanner,
        showModal: showModal,
        hideModal: hideModal
    };

})();

