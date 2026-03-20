/**
 * Admin Sidebar Collapse/Expand Functionality
 * Handles sidebar toggle and state persistence
 */

(function() {
    'use strict';

    const SIDEBAR_STATE_KEY = 'adminSidebarCollapsed';
    const sidebar = document.getElementById('adminSidebar');
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    const adminMain = document.querySelector('.admin-main');

    /**
     * Initialize sidebar state
     */
    function initSidebar() {
        if (!sidebar) return;

        // Load saved state from localStorage
        const savedState = localStorage.getItem(SIDEBAR_STATE_KEY);
        const isCollapsed = savedState === 'true';

        if (isCollapsed) {
            collapseSidebar(false); // Don't animate on initial load
        }

        // Setup toggle button (desktop collapse/expand)
        if (collapseBtn) {
            collapseBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleSidebar();
            });
        }
        
        // Don't interfere with mobile sidebar toggle (sidebarToggle button)
        // Mobile toggle is handled by dashboard.js, products.js, etc.

        // Setup tooltips for collapsed state
        setupTooltips();
    }

    /**
     * Toggle sidebar collapsed state
     */
    function toggleSidebar() {
        const isCollapsed = sidebar.classList.contains('collapsed');
        
        if (isCollapsed) {
            expandSidebar();
        } else {
            collapseSidebar(true);
        }
    }

    /**
     * Collapse sidebar
     */
    function collapseSidebar(animate = true) {
        if (!animate) {
            sidebar.style.transition = 'none';
        }
        
        sidebar.classList.add('collapsed');
        localStorage.setItem(SIDEBAR_STATE_KEY, 'true');
        
        if (!animate) {
            // Re-enable transitions after a brief delay
            setTimeout(() => {
                sidebar.style.transition = '';
            }, 50);
        }

        // Update tooltips
        updateTooltips(true);
    }

    /**
     * Expand sidebar
     */
    function expandSidebar() {
        sidebar.classList.remove('collapsed');
        localStorage.setItem(SIDEBAR_STATE_KEY, 'false');
        
        // Update tooltips
        updateTooltips(false);
    }

    /**
     * Setup tooltips for nav items when collapsed
     */
    function setupTooltips() {
        const navItems = sidebar.querySelectorAll('.nav-item');
        
        navItems.forEach(item => {
            const text = item.querySelector('span');
            if (text) {
                const tooltipText = text.textContent.trim();
                item.setAttribute('data-tooltip', tooltipText);
            }
        });
    }

    /**
     * Update tooltips visibility
     */
    function updateTooltips(isCollapsed) {
        const navItems = sidebar.querySelectorAll('.nav-item');
        
        navItems.forEach(item => {
            if (isCollapsed) {
                item.classList.add('has-tooltip');
            } else {
                item.classList.remove('has-tooltip');
            }
        });
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSidebar);
    } else {
        initSidebar();
    }

    // Export for use in other scripts
    window.AdminSidebar = {
        toggle: toggleSidebar,
        collapse: collapseSidebar,
        expand: expandSidebar
    };

})();

