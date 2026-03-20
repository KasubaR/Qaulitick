// Admin Settings Management JavaScript

let originalSettings = {};
let hasUnsavedChanges = false;

document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication before initializing
    const isAuthenticated = await window.AuthUtils?.initializeAuthCheck();
    if (!isAuthenticated) {
        return; // Redirect will happen in initializeAuthCheck
    }
    
    initializeSettingsPage();
    setupEventListeners();
    loadSettings();
});

// Initialize settings page
function initializeSettingsPage() {
    setupSidebar();
    setupTabs();
    setupFormWatchers();
}

// Setup event listeners
function setupEventListeners() {
    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', toggleSidebar);
    }

    // Reset settings button
    const resetSettingsBtn = document.getElementById('resetSettingsBtn');
    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener('click', resetSettings);
    }

    // Form submissions
    const forms = document.querySelectorAll('.settings-form');
    forms.forEach(form => {
        form.addEventListener('submit', handleFormSubmit);
    });

    // Test buttons
    const testPaymentConnectionBtn = document.getElementById('testPaymentConnectionBtn');
    if (testPaymentConnectionBtn) {
        testPaymentConnectionBtn.addEventListener('click', testPaymentConnection);
    }

    const testEmailBtn = document.getElementById('testEmailBtn');
    if (testEmailBtn) {
        testEmailBtn.addEventListener('click', testEmailConnection);
    }

    // Before unload warning
    window.addEventListener('beforeunload', (e) => {
        if (hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
            return e.returnValue;
        }
    });
}

// Setup sidebar
function setupSidebar() {
    const currentPath = window.location.pathname;
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        if (item.getAttribute('href') === currentPath) {
            item.classList.add('active');
        }
    });
}

// Toggle sidebar (mobile)
function toggleSidebar() {
    const sidebar = document.querySelector('.admin-sidebar');
    sidebar.classList.toggle('active');
}

// Setup tabs
function setupTabs() {
    const tabBtns = document.querySelectorAll('.settings-tab');
    const panes = document.querySelectorAll('.settings-pane');
    
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;
            
            // Remove active class from all tabs and panes
            tabBtns.forEach(b => b.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));
            
            // Add active class to clicked tab and corresponding pane
            btn.classList.add('active');
            const targetPane = document.getElementById(targetTab + 'Pane');
            if (targetPane) {
                targetPane.classList.add('active');
            }
        });
    });
}

// Setup form watchers to detect changes
function setupFormWatchers() {
    const inputs = document.querySelectorAll('.settings-form input, .settings-form select, .settings-form textarea');
    inputs.forEach(input => {
        input.addEventListener('change', () => {
            hasUnsavedChanges = true;
            updateResetButton();
        });
    });
}

// Update reset button state
function updateResetButton() {
    const resetBtn = document.getElementById('resetSettingsBtn');
    if (resetBtn) {
        if (hasUnsavedChanges) {
            resetBtn.disabled = false;
            resetBtn.style.opacity = '1';
        } else {
            resetBtn.disabled = true;
            resetBtn.style.opacity = '0.5';
        }
    }
}

// Handle form submission
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const form = e.target;
    const formId = form.id;
    
    // Map form IDs to settings categories
    const formCategoryMap = {
        'generalSettingsForm': 'general',
        'storeSettingsForm': 'store',
        'paymentSettingsForm': 'payment',
        'emailSettingsForm': 'email',
        'securitySettingsForm': 'security',
        'notificationSettingsForm': 'notifications'
    };
    
    const category = formCategoryMap[formId];
    if (!category) {
        showMessage('Unknown form category', 'error');
        return;
    }
    
    const formData = new FormData(form);
    let data = Object.fromEntries(formData.entries());
    
    // Handle checkboxes
    const checkboxes = form.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        data[checkbox.name] = checkbox.checked;
    });
    
    // Special handling for notifications category (nested structure)
    if (category === 'notifications') {
        data = {
            email: {
                notifyNewOrders: data.notifyNewOrders || false,
                notifyLowStock: data.notifyLowStock || false,
                notifyPayments: data.notifyPayments || false,
                notifyContactSubmissions: data.notifyContactSubmissions || false,
                notificationEmail: data.notificationEmail || 'Peterkinpin98@gmail.com'
            },
            inApp: {
                showOrderBadges: data.showOrderBadges || false,
                showStockAlerts: data.showStockAlerts || false
            }
        };
    }
    
    // Show loading state
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }
    
    try {
        // Call API to update settings
        await AdminSettingsAPI.updateSettings(category, data);
        
        showMessage(`${category.charAt(0).toUpperCase() + category.slice(1)} settings saved successfully!`, 'success');
        hasUnsavedChanges = false;
        updateResetButton();
        
        // Reload settings to get updated values
        await loadSettings();
    } catch (error) {
        console.error('Error saving settings:', error);
        showMessage(error.message || 'Failed to save settings', 'error');
    } finally {
        // Restore button state
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }
    }
}

// Reset settings
async function resetSettings() {
    if (!confirm('Are you sure you want to reset all unsaved changes?')) {
        return;
    }
    
    // Reload settings from API
    await loadSettings();
    
    hasUnsavedChanges = false;
    updateResetButton();
    showMessage('Settings reset to last saved values', 'info');
}

// Test payment connection
async function testPaymentConnection() {
    const btn = document.getElementById('testPaymentConnectionBtn');
    if (!btn) return;
    
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
    
    try {
        const result = await AdminSettingsAPI.testPayment();
        
        if (result.configured) {
            showMessage('Payment gateway settings are configured correctly', 'success');
        } else {
            showMessage('Payment gateway settings are not fully configured', 'warning');
        }
    } catch (error) {
        console.error('Error testing payment connection:', error);
        showMessage(error.message || 'Payment gateway connection test failed', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Test email connection
async function testEmailConnection() {
    const btn = document.getElementById('testEmailBtn');
    if (!btn) return;
    
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    
    try {
        const result = await AdminSettingsAPI.testEmail();
        
        if (result.recipient) {
            showMessage(`Test email sent successfully to ${result.recipient}!`, 'success');
        } else {
            showMessage('Test email sent successfully!', 'success');
        }
    } catch (error) {
        console.error('Error sending test email:', error);
        showMessage(error.message || 'Failed to send test email', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Toggle password visibility
function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    const button = input.nextElementSibling;
    
    if (!input || !button) return;
    
    if (input.type === 'password') {
        input.type = 'text';
        button.innerHTML = '<i class="fas fa-eye-slash"></i>';
    } else {
        input.type = 'password';
        button.innerHTML = '<i class="fas fa-eye"></i>';
    }
}

// Load settings from API
async function loadSettings() {
    try {
        // Show loading indicator
        const settingsContent = document.querySelector('.settings-content');
        if (settingsContent) {
            const loadingEl = document.createElement('div');
            loadingEl.id = 'settingsLoading';
            loadingEl.className = 'settings-loading';
            loadingEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading settings...';
            settingsContent.insertBefore(loadingEl, settingsContent.firstChild);
        }
        
        const settings = await AdminSettingsAPI.getSettings();
        populateSettings(settings);
        
        hasUnsavedChanges = false;
        updateResetButton();
    } catch (error) {
        console.error('Error loading settings:', error);
        showMessage(error.message || 'Failed to load settings', 'error');
    } finally {
        // Remove loading indicator
        const loadingEl = document.getElementById('settingsLoading');
        if (loadingEl) {
            loadingEl.remove();
        }
    }
}

// Populate settings forms
function populateSettings(settings) {
    // General settings
    if (settings.general) {
        const form = document.getElementById('generalSettingsForm');
        if (form) {
            Object.keys(settings.general).forEach(key => {
                const input = form.querySelector(`[name="${key}"]`);
                if (input) {
                    if (input.type === 'checkbox') {
                        input.checked = settings.general[key];
                    } else {
                        input.value = settings.general[key] || '';
                    }
                }
            });
        }
    }
    
    // Store settings
    if (settings.store) {
        const form = document.getElementById('storeSettingsForm');
        if (form) {
            Object.keys(settings.store).forEach(key => {
                const input = form.querySelector(`[name="${key}"]`);
                if (input) {
                    input.value = settings.store[key] || '';
                }
            });
        }
    }
    
    // Payment settings
    if (settings.payment) {
        const form = document.getElementById('paymentSettingsForm');
        if (form) {
            Object.keys(settings.payment).forEach(key => {
                const input = form.querySelector(`[name="${key}"]`);
                if (input) {
                    input.value = settings.payment[key] || '';
                }
            });
        }
    }
    
    // Email settings
    if (settings.email) {
        const form = document.getElementById('emailSettingsForm');
        if (form) {
            Object.keys(settings.email).forEach(key => {
                const input = form.querySelector(`[name="${key}"]`);
                if (input) {
                    if (input.type === 'checkbox') {
                        input.checked = settings.email[key];
                    } else {
                        input.value = settings.email[key] || '';
                    }
                }
            });
        }
    }
    
    // Security settings
    if (settings.security) {
        const form = document.getElementById('securitySettingsForm');
        if (form) {
            Object.keys(settings.security).forEach(key => {
                const input = form.querySelector(`[name="${key}"]`);
                if (input) {
                    if (input.type === 'checkbox') {
                        input.checked = settings.security[key];
                    } else {
                        input.value = settings.security[key] || '';
                    }
                }
            });
        }
    }
    
    // Notification settings (handle nested structure)
    if (settings.notifications) {
        const form = document.getElementById('notificationSettingsForm');
        if (form) {
            // Handle email notifications
            if (settings.notifications.email) {
                const emailSettings = settings.notifications.email;
                if (emailSettings.notifyNewOrders !== undefined) {
                    const input = form.querySelector('[name="notifyNewOrders"]');
                    if (input) input.checked = emailSettings.notifyNewOrders;
                }
                if (emailSettings.notifyLowStock !== undefined) {
                    const input = form.querySelector('[name="notifyLowStock"]');
                    if (input) input.checked = emailSettings.notifyLowStock;
                }
                if (emailSettings.notifyPayments !== undefined) {
                    const input = form.querySelector('[name="notifyPayments"]');
                    if (input) input.checked = emailSettings.notifyPayments;
                }
                if (emailSettings.notifyContactSubmissions !== undefined) {
                    const input = form.querySelector('[name="notifyContactSubmissions"]');
                    if (input) input.checked = emailSettings.notifyContactSubmissions;
                }
                if (emailSettings.notificationEmail) {
                    const input = form.querySelector('[name="notificationEmail"]');
                    if (input) input.value = emailSettings.notificationEmail || '';
                }
            }
            
            // Handle in-app notifications
            if (settings.notifications.inApp) {
                const inAppSettings = settings.notifications.inApp;
                if (inAppSettings.showOrderBadges !== undefined) {
                    const input = form.querySelector('[name="showOrderBadges"]');
                    if (input) input.checked = inAppSettings.showOrderBadges;
                }
                if (inAppSettings.showStockAlerts !== undefined) {
                    const input = form.querySelector('[name="showStockAlerts"]');
                    if (input) input.checked = inAppSettings.showStockAlerts;
                }
            }
        }
    }
    
    // Store original settings
    originalSettings = JSON.parse(JSON.stringify(settings));
}

// Show message
function showMessage(message, type = 'info') {
    // Remove existing messages
    const existingMessages = document.querySelectorAll('.settings-message');
    existingMessages.forEach(msg => msg.remove());
    
    // Create new message
    const messageEl = document.createElement('div');
    messageEl.className = `settings-message ${type} show`;
    messageEl.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    // Insert at the top of settings content
    const settingsContent = document.querySelector('.settings-content');
    if (settingsContent) {
        settingsContent.insertBefore(messageEl, settingsContent.firstChild);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            messageEl.classList.remove('show');
            setTimeout(() => messageEl.remove(), 300);
        }, 5000);
    }
}

// Make togglePassword globally available
window.togglePassword = togglePassword;

