// Client-side Error Handling and Retry Mechanism

/**
 * Retry mechanism for network requests
 * @param {Function} fn - Function that returns a Promise
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} delay - Initial delay in milliseconds
 * @returns {Promise} - Promise that resolves with the result
 */
async function retryRequest(fn, maxRetries = 3, delay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            // Don't retry on client errors (4xx)
            if (error.status && error.status >= 400 && error.status < 500) {
                throw error;
            }
            
            // Don't retry on last attempt
            if (attempt === maxRetries) {
                break;
            }
            
            // Exponential backoff
            const waitTime = delay * Math.pow(2, attempt - 1);
            console.log(`[Retry] Attempt ${attempt} failed, retrying in ${waitTime}ms...`);
            
            // Show retry notification to user
            showRetryNotification(attempt, maxRetries, waitTime);
            
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
    
    throw new Error(`Request failed after ${maxRetries} attempts: ${lastError.message}`);
}

/**
 * Show retry notification to user
 */
function showRetryNotification(attempt, maxRetries, waitTime) {
    // Remove existing notification
    const existing = document.getElementById('retry-notification');
    if (existing) {
        existing.remove();
    }
    
    // Create notification
    const notification = document.createElement('div');
    notification.id = 'retry-notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(255, 193, 7, 0.9);
        color: #000;
        padding: 15px 20px;
        border-radius: 5px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 500;
        max-width: 300px;
    `;
    
    notification.innerHTML = `
        <i class="fas fa-sync-alt fa-spin"></i>
        <span>Retrying... (${attempt}/${maxRetries})</span>
    `;
    
    document.body.appendChild(notification);
    
    // Remove after delay
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, waitTime);
}

/**
 * Enhanced fetch with retry mechanism
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
    return retryRequest(async () => {
        const response = await fetch(url, options);
        
        if (!response.ok) {
            // Handle different error types
            if (response.status >= 500) {
                throw new Error(`Server error: ${response.status}`);
            } else if (response.status === 404) {
                throw new Error('Resource not found');
            } else {
                const error = new Error(`Request failed: ${response.status}`);
                error.status = response.status;
                throw error;
            }
        }
        
        return response;
    }, maxRetries);
}

/**
 * Handle network errors globally
 */
window.addEventListener('error', (event) => {
    if (event.error && event.error.message && event.error.message.includes('fetch')) {
        console.error('[Network Error]', event.error);
        showNetworkErrorNotification();
    }
});

/**
 * Handle unhandled promise rejections (network failures)
 */
window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && (
        event.reason.message.includes('fetch') ||
        event.reason.message.includes('network') ||
        event.reason.message.includes('Failed to fetch')
    )) {
        console.error('[Network Error]', event.reason);
        showNetworkErrorNotification();
    }
});

/**
 * Show network error notification
 */
function showNetworkErrorNotification() {
    // Remove existing notification
    const existing = document.getElementById('network-error-notification');
    if (existing) {
        return;
    }
    
    const notification = document.createElement('div');
    notification.id = 'network-error-notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(255, 68, 68, 0.95);
        color: #fff;
        padding: 15px 20px;
        border-radius: 5px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        z-index: 10001;
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 500;
        max-width: 350px;
    `;
    
    notification.innerHTML = `
        <i class="fas fa-wifi"></i>
        <div style="flex: 1;">
            <div style="font-weight: 600; margin-bottom: 5px;">Network Error</div>
            <div style="font-size: 12px; opacity: 0.9;">Please check your connection and try again.</div>
        </div>
        <button onclick="this.parentElement.remove(); window.location.reload();" style="background: rgba(255, 255, 255, 0.2); border: none; color: #fff; padding: 5px 10px; border-radius: 3px; cursor: pointer; font-size: 12px;">
            Retry
        </button>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 10000);
}

// Export for use in other scripts
window.retryRequest = retryRequest;
window.fetchWithRetry = fetchWithRetry;

