/**
 * Google Analytics Event Tracking
 * 
 * Helper functions to track custom events in Google Analytics (GA4)
 * Only tracks if user has consented to Analytics cookies
 */

(function() {
    'use strict';

    /**
     * Check if Analytics is available and user has consented
     */
    function isAnalyticsAvailable() {
        // Check if gtag is available
        if (typeof gtag === 'undefined') {
            return false;
        }

        // Check if user has consented to Analytics cookies
        if (typeof window.CookieUtils !== 'undefined') {
            return window.CookieUtils.isCategoryAllowed(window.CookieUtils.COOKIE_CATEGORIES.ANALYTICS);
        }

        return false;
    }

    /**
     * Track a custom event in Google Analytics
     * @param {string} eventName - Event name
     * @param {object} eventParams - Event parameters
     */
    function trackEvent(eventName, eventParams = {}) {
        if (!isAnalyticsAvailable()) {
            return;
        }

        try {
            gtag('event', eventName, eventParams);
        } catch (error) {
            console.error('[Analytics] Error tracking event:', error);
        }
    }

    /**
     * Track page view
     * @param {string} pagePath - Page path
     * @param {string} pageTitle - Page title
     */
    function trackPageView(pagePath, pageTitle) {
        if (!isAnalyticsAvailable()) {
            return;
        }

        try {
            gtag('config', window.GA4_MEASUREMENT_ID || '', {
                'page_path': pagePath,
                'page_title': pageTitle
            });
        } catch (error) {
            console.error('[Analytics] Error tracking page view:', error);
        }
    }

    /**
     * Track add to cart event
     * @param {object} product - Product information
     */
    function trackAddToCart(product) {
        trackEvent('add_to_cart', {
            'currency': 'ZMW',
            'value': product.price || 0,
            'items': [{
                'item_id': product.id || product.productId,
                'item_name': product.name,
                'price': product.price || 0,
                'quantity': product.quantity || 1
            }]
        });
    }

    /**
     * Track purchase event
     * @param {object} orderData - Order information
     */
    function trackPurchase(orderData) {
        trackEvent('purchase', {
            'transaction_id': orderData.orderNumber || orderData.transactionId,
            'value': orderData.total || orderData.amount || 0,
            'currency': 'ZMW',
            'items': (orderData.items || []).map(item => ({
                'item_id': item.id || item.productId,
                'item_name': item.name,
                'price': item.price || 0,
                'quantity': item.quantity || 1
            }))
        });
    }

    /**
     * Track begin checkout event
     * @param {object} checkoutData - Checkout information
     */
    function trackBeginCheckout(checkoutData) {
        trackEvent('begin_checkout', {
            'currency': 'ZMW',
            'value': checkoutData.total || checkoutData.amount || 0,
            'items': (checkoutData.items || []).map(item => ({
                'item_id': item.id || item.productId,
                'item_name': item.name,
                'price': item.price || 0,
                'quantity': item.quantity || 1
            }))
        });
    }

    /**
     * Track view item event
     * @param {object} product - Product information
     */
    function trackViewItem(product) {
        trackEvent('view_item', {
            'currency': 'ZMW',
            'value': product.price || 0,
            'items': [{
                'item_id': product.id || product.productId,
                'item_name': product.name,
                'price': product.price || 0,
                'category': product.category || product.brand || 'Watches'
            }]
        });
    }

    /**
     * Track search event
     * @param {string} searchTerm - Search query
     */
    function trackSearch(searchTerm) {
        trackEvent('search', {
            'search_term': searchTerm
        });
    }

    /**
     * Track newsletter subscription
     */
    function trackNewsletterSubscribe() {
        trackEvent('newsletter_subscribe');
    }

    /**
     * Track contact form submission
     */
    function trackContactForm() {
        trackEvent('contact_form_submit');
    }

    /**
     * Listen for consent changes and reload GA if needed
     */
    function setupConsentListener() {
        window.addEventListener('cookieConsentUpdated', function(event) {
            const preferences = event.detail;
            
            if (preferences.analytics && typeof gtag === 'undefined') {
                // User just consented, reload page to initialize GA
                // Or dynamically load GA script here
                window.location.reload();
            } else if (!preferences.analytics && typeof gtag !== 'undefined') {
                // User withdrew consent, clear GA cookies
                // GA cookies will be cleared by cookie-utils, but we can also disable tracking
                console.log('[Analytics] Analytics consent withdrawn');
            }
        });
    }

    // Initialize consent listener
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupConsentListener);
    } else {
        setupConsentListener();
    }

    // Export functions for use in other scripts
    window.AnalyticsEvents = {
        trackEvent,
        trackPageView,
        trackAddToCart,
        trackPurchase,
        trackBeginCheckout,
        trackViewItem,
        trackSearch,
        trackNewsletterSubscribe,
        trackContactForm,
        isAnalyticsAvailable
    };

})();

