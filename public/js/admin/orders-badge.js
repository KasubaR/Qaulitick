/**
 * Orders Badge Utility
 * Polls a lightweight admin-only count endpoint to show the unread orders badge.
 * No full order objects are fetched; the server returns only a count — no PII
 * is pulled into the browser just to render a number.
 */

(function(window) {
    'use strict';

    const LAST_VIEWED_KEY = 'admin_orders_last_viewed';
    const BADGE_ID = 'newOrdersBadge';
    let lastViewedTime = null;

    function loadLastViewedTime() {
        try {
            const stored = localStorage.getItem(LAST_VIEWED_KEY);
            if (stored) {
                lastViewedTime = new Date(stored);
            } else {
                // First visit — treat all existing orders as already read
                lastViewedTime = new Date();
                saveLastViewedTime();
            }
        } catch (error) {
            console.error('[Orders Badge] Error loading last viewed time:', error);
            lastViewedTime = new Date();
        }
    }

    function saveLastViewedTime() {
        try {
            if (lastViewedTime) {
                localStorage.setItem(LAST_VIEWED_KEY, lastViewedTime.toISOString());
            }
        } catch (error) {
            console.error('[Orders Badge] Error saving last viewed time:', error);
        }
    }

    function markOrdersAsViewed() {
        lastViewedTime = new Date();
        saveLastViewedTime();
        updateBadge();
    }

    /**
     * Fetch only the count of orders created after `since` from the admin endpoint.
     * Returns 0 on any error so the badge stays hidden rather than showing stale data.
     */
    async function fetchUnreadCount(since) {
        try {
            const url = `/api/admin/orders/unread-count?since=${encodeURIComponent(since.toISOString())}`;
            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) return 0;
            const data = await response.json();
            return (data.success && typeof data.count === 'number') ? data.count : 0;
        } catch (error) {
            console.error('[Orders Badge] Error fetching unread count:', error);
            return 0;
        }
    }

    async function updateBadge() {
        const badge = document.getElementById(BADGE_ID);
        if (!badge) return;

        // On the orders page every order is immediately visible — badge is always 0
        if (window.location.pathname === '/admin/orders') {
            badge.textContent = '0';
            badge.style.display = 'none';
            return;
        }

        try {
            const count = await fetchUnreadCount(lastViewedTime);
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : String(count);
                badge.style.display = 'inline-block';
            } else {
                badge.textContent = '0';
                badge.style.display = 'none';
            }
        } catch (error) {
            console.error('[Orders Badge] Error updating badge:', error);
        }
    }

    function init() {
        loadLastViewedTime();
        updateBadge();
        // Poll every 30 seconds on non-orders pages
        if (window.location.pathname !== '/admin/orders') {
            setInterval(updateBadge, 30000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.OrdersBadge = {
        update: updateBadge,
        markAsViewed: markOrdersAsViewed,
        refresh: updateBadge
    };

})(window);
