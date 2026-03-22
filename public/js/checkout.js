// Checkout Page JavaScript

// Cart data (using different variable name to avoid conflict with main.js)
let checkoutCartItems = [];
let deliveryFee = 0;

// Payment polling
let paymentPollInterval = null;
let paymentPollStartTime = null;
const PAYMENT_POLL_INTERVAL = 15000; // 15 seconds (rate limit: 60 requests/15min = 4 req/min = 1 every 15s)
const PAYMENT_POLL_TIMEOUT = 15 * 60 * 1000; // 15 minutes
let currentTransactionId = null;
let rateLimitBackoff = 0; // Exponential backoff for rate limits
const PENDING_TRANSACTION_KEY = 'checkout_pending_transaction_id';

// If the browser restores this page from bfcache (back-forward navigation), kill any
// stale polling interval that was running before navigation so it cannot fire again.
window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
        stopPaymentPolling();
    }
});

// Initialize checkout page
function setupLaybyCheckoutSection() {
    const ctx = document.getElementById('checkout-auth-context');
    const section = document.getElementById('laybyCheckoutSection');
    const depositWrap = document.getElementById('laybyDepositWrap');
    if (!section) return;

    if (ctx && ctx.dataset.laybyEligible === 'true') {
        section.classList.remove('layby-checkout-section--hidden');
    }

    const radios = document.querySelectorAll('input[name="checkoutMode"]');
    function syncDepositVisibility() {
        const layby = document.getElementById('checkoutModeLayby');
        if (!depositWrap || !layby) return;
        if (layby.checked) {
            depositWrap.classList.remove('layby-deposit-wrap--hidden');
        } else {
            depositWrap.classList.add('layby-deposit-wrap--hidden');
        }
    }
    radios.forEach((r) => r.addEventListener('change', syncDepositVisibility));
    syncDepositVisibility();
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadCartItems();
    setupEventListeners();
    calculateDeliveryFee();
    updateOrderSummary();
    setupPaymentMethodSelection();
    setupLaybyCheckoutSection();

    // Resume polling for a payment that was pending when the user navigated away
    const pendingTxId = sessionStorage.getItem(PENDING_TRANSACTION_KEY);
    if (pendingTxId) {
        console.log(`[Payment Polling] Resuming polling for pending transaction: ${pendingTxId}`);
        startPaymentPolling(pendingTxId);
    }
});

// Setup payment method selection UI
function setupPaymentMethodSelection() {
    const paymentMethodInputs = document.querySelectorAll('input[name="paymentMethod"]');

    paymentMethodInputs.forEach(input => {
        input.addEventListener('change', () => {
            updatePaymentMethodUI(input.value);
        });
    });

    // Initialize UI based on default selection
    const defaultMethod = document.querySelector('input[name="paymentMethod"]:checked');
    if (defaultMethod) {
        updatePaymentMethodUI(defaultMethod.value);
    }
}

// Update payment method UI based on selection
function updatePaymentMethodUI(method) {
    // Remove existing payment method options
    const existingProviderSection = document.getElementById('mobileProviderSection');
    const existingPaymentPhoneSection = document.getElementById('paymentPhoneSection');
    const existingBankSection = document.getElementById('bankTransferSection');

    if (existingProviderSection) {
        existingProviderSection.remove();
    }
    if (existingPaymentPhoneSection) {
        existingPaymentPhoneSection.remove();
    }
    if (existingBankSection) {
        existingBankSection.remove();
    }

    // Get payment method section
    const paymentSection = document.querySelector('.payment-methods').closest('.form-section');
    if (!paymentSection) return;

    // Add provider selection for Mobile Money
    if (method === 'mobile' || method === 'mobile_money') {
        const providerSection = document.createElement('div');
        providerSection.id = 'mobileProviderSection';
        providerSection.className = 'form-group';
        providerSection.innerHTML = `
            <label for="mobileProvider">Mobile Money Provider <span class="required">*</span></label>
            <select id="mobileProvider" name="mobileProvider" class="form-input" required>
                <option value="">Select Provider</option>
                <option value="airtel">Airtel Money</option>
                <option value="mtn">MTN Mobile Money</option>
            </select>
            <span class="error-message" id="mobileProviderError"></span>
        `;
        paymentSection.appendChild(providerSection);

        // Add payment phone number field
        const paymentPhoneSection = document.createElement('div');
        paymentPhoneSection.id = 'paymentPhoneSection';
        paymentPhoneSection.className = 'form-group';
        paymentPhoneSection.innerHTML = `
            <label for="paymentPhone">Mobile Money Number <span class="required">*</span></label>
            <input 
                type="tel" 
                id="paymentPhone" 
                name="paymentPhone" 
                class="form-input" 
                required
                placeholder="+260 9XX XXX XXX (Number you want to pay from)"
            >
            <small style="display: block; margin-top: 5px; color: #64748b; font-size: 12px;">
                Enter the phone number registered with your mobile money account
            </small>
            <span class="error-message" id="paymentPhoneError"></span>
        `;
        paymentSection.appendChild(paymentPhoneSection);

        // Add event listener to validate phone matches provider
        setTimeout(() => {
            const mobileProvider = document.getElementById('mobileProvider');
            const paymentPhone = document.getElementById('paymentPhone');

            if (mobileProvider && paymentPhone) {
                // Validate when provider changes
                mobileProvider.addEventListener('change', () => {
                    validatePaymentPhone();
                });

                // Validate when phone number changes
                paymentPhone.addEventListener('blur', () => {
                    validatePaymentPhone();
                });
            }
        }, 100);
    }

    // Bank Transfer - DISABLED FOR NOW (Will be enabled in future update)
    /*
    if (method === 'bank' || method === 'bank_transfer') {
        const bankSection = document.createElement('div');
        bankSection.id = 'bankTransferSection';
        bankSection.className = 'form-group';
        bankSection.innerHTML = `
            <label for="bankName">Select Your Bank <span class="required">*</span></label>
            <div class="bank-select-wrapper">
                <select id="bankName" name="bankName" class="form-input" required disabled>
                    <option value="">-- Loading Banks --</option>
                </select>
                <div id="bankLoadingSpinner" class="bank-loading-spinner">
                    <i class="fas fa-spinner fa-spin"></i>
                </div>
            </div>
            <span class="error-message" id="bankNameError"></span>
        `;
        paymentSection.appendChild(bankSection);
        
        // Load banks from API (lazy loading - only when needed)
        loadBanks();
    }
    */
}

// Load cart items from localStorage and validate prices server-side
// Load cart items from cookies (primary) or localStorage (fallback)
// Always validates server-side to get authoritative prices and prevent manipulation
async function loadCartItems() {
    try {
        let cartData = null;
        let storageSource = null;

        // Try to get from cookies first (for server-side sync)
        if (typeof window.CookieUtils !== 'undefined') {
            try {
                const cookieData = window.CookieUtils.getCookie('cart');
                if (cookieData) {
                    cartData = JSON.parse(cookieData);
                    storageSource = 'cookie';
                    console.log('[Checkout] Loaded cart from cookies');
                }
            } catch (e) {
                console.warn('[Checkout] Failed to parse cookie data, trying localStorage');
            }
        }

        // Fallback to localStorage if cookie not available or empty
        if (!cartData) {
            try {
                const localData = localStorage.getItem('cart');
                if (localData) {
                    cartData = JSON.parse(localData);
                    storageSource = 'localStorage';
                    console.log('[Checkout] Loaded cart from localStorage (fallback)');
                }
            } catch (e) {
                console.error('[Checkout] Failed to parse localStorage data');
            }
        }

        // If no cart data found in either storage, redirect to cart
        if (!cartData || !Array.isArray(cartData) || cartData.length === 0) {
            console.warn('[Checkout] No cart data found in storage, redirecting to cart');
            showNotification('Your cart is empty. Redirecting to cart...', 'warning');
            setTimeout(() => {
                window.location.href = '/cart';
            }, 1500);
            return;
        }

        // Normalize prices (handle both number and string formats)
        checkoutCartItems = cartData.map(item => {
            // Normalize price to number
            let price = item.price;
            if (typeof price === 'string') {
                price = parseFloat(price.replace(/[K,]/g, '')) || 0;
            } else if (typeof price !== 'number') {
                price = 0;
            }

            // Normalize variant structure (backward compatibility)
            let variant = item.variant;
            if (!variant && (item.color || item.strap)) {
                variant = {
                    color: item.color || null,
                    strap: item.strap || null
                };
            }
            variant = variant || { color: null, strap: null };

            return {
                ...item,
                price: price, // Always store as NUMBER
                productId: item.productId || item.id,
                variant: variant
            };
        });

        // SECURITY: Always validate cart items server-side to get authoritative prices
        // This prevents price manipulation and ensures stock availability
        try {
            // Get CSRF token for authenticated request
            const csrfToken = typeof getCSRFToken === 'function' ? getCSRFToken() : (typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : '');

            const response = await fetch('/api/cart/validate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({
                    items: checkoutCartItems,
                    delivery: deliveryFee,
                    couponDiscount: 0 // TODO: Add coupon support
                })
            });

            if (!response.ok) {
                throw new Error(`Validation failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            // If validation fails, redirect to cart
            if (!data.success || !data.items || data.items.length === 0) {
                console.error('[Checkout] Cart validation failed:', data.message || 'Unknown error');
                showNotification(data.message || 'Cart validation failed. Redirecting to cart...', 'error');
                setTimeout(() => {
                    window.location.href = '/cart';
                }, 2000);
                return;
            }

            // CRITICAL: Use server-validated prices (prevents price manipulation)
            checkoutCartItems = data.items.map(item => ({
                ...item,
                price: typeof item.price === 'number' ? item.price : parseFloat(String(item.price).replace(/[K,]/g, '')) || 0
            }));

            // Update totals with server-calculated values
            if (data.totals) {
                window.serverValidatedTotals = data.totals;
            }

            // Show warnings if any items had price/stock issues
            if (data.warnings && data.warnings.length > 0) {
                data.warnings.forEach(warning => {
                    console.warn('[Checkout] Cart validation warning:', warning.message);
                    // Show user-friendly notification
                    if (warning.message.includes('Price updated')) {
                        showNotification(`Price updated for ${warning.itemId ? 'an item' : 'items'}. Please review your order.`, 'warning');
                    } else if (warning.message.includes('available') || warning.message.includes('stock')) {
                        showNotification(warning.message, 'warning');
                    }
                });
            }

            // Save validated cart back to storage (only if we successfully saved to that storage before)
            // This ensures the validated prices persist
            try {
                if (storageSource === 'cookie' && typeof window.CookieUtils !== 'undefined') {
                    const cartJson = JSON.stringify(checkoutCartItems);
                    const MAX_COOKIE_SIZE = 4000;
                    if (cartJson.length <= MAX_COOKIE_SIZE) {
                        window.CookieUtils.setCookie('cart', cartJson, {
                            expires: 7,
                            path: '/',
                            secure: window.location.protocol === 'https:',
                            sameSite: 'Lax'
                        });
                    }
                }

                // Always try to save to localStorage as well (for cross-tab sync)
                localStorage.setItem('cart', JSON.stringify(checkoutCartItems));
            } catch (saveError) {
                console.warn('[Checkout] Failed to save validated cart to storage:', saveError);
                // Non-critical: continue even if save fails
            }

        } catch (error) {
            console.error('[Checkout] Error validating cart items:', error);
            showNotification('Failed to validate cart. Redirecting to cart...', 'error');
            setTimeout(() => {
                window.location.href = '/cart';
            }, 2000);
            return;
        }

        // Final check: if cart is empty after validation, redirect
        if (checkoutCartItems.length === 0) {
            console.warn('[Checkout] Cart is empty after validation, redirecting to cart');
            showNotification('Your cart is empty. Redirecting to cart...', 'warning');
            setTimeout(() => {
                window.location.href = '/cart';
            }, 1500);
            return;
        }

    } catch (error) {
        console.error('[Checkout] Error loading cart:', error);
        showNotification('Error loading cart. Redirecting to cart...', 'error');
        setTimeout(() => {
            window.location.href = '/cart';
        }, 2000);
        return;
    }
}

// Setup event listeners
function setupEventListeners() {
    // Form submission
    const checkoutForm = document.getElementById('checkoutForm');
    if (checkoutForm) {
        checkoutForm.addEventListener('submit', handleFormSubmit);
    }

    // Province change (no longer affects delivery fee since it's free)
    const province = document.getElementById('province');
    // Note: Delivery fee is always free, so no need to recalculate on province change

    // Pickup option toggle
    const pickupOption = document.getElementById('pickupOption');
    if (pickupOption) {
        pickupOption.addEventListener('change', () => {
            calculateDeliveryFee();
            const deliveryAddress = document.getElementById('deliveryAddress');
            const city = document.getElementById('city');
            const province = document.getElementById('province');

            if (pickupOption.checked) {
                deliveryAddress.disabled = true;
                city.disabled = true;
                province.disabled = true;
                deliveryFee = 0;
            } else {
                deliveryAddress.disabled = false;
                city.disabled = false;
                province.disabled = false;
                calculateDeliveryFee();
            }
            updateOrderSummary();
        });
    }

    // Modal close buttons
    const closeSuccessModal = document.getElementById('closeSuccessModal');
    if (closeSuccessModal) {
        closeSuccessModal.addEventListener('click', () => {
            document.getElementById('successModal').style.display = 'none';
        });
    }

    const closeErrorModal = document.getElementById('closeErrorModal');
    if (closeErrorModal) {
        closeErrorModal.addEventListener('click', () => {
            document.getElementById('errorModal').style.display = 'none';
        });
    }

    const retryPaymentBtn = document.getElementById('retryPaymentBtn');
    if (retryPaymentBtn) {
        retryPaymentBtn.addEventListener('click', () => {
            document.getElementById('errorModal').style.display = 'none';
            document.getElementById('checkoutForm').requestSubmit();
        });
    }

    const cancelPaymentBtn = document.getElementById('cancelPaymentBtn');
    if (cancelPaymentBtn) {
        cancelPaymentBtn.addEventListener('click', () => {
            document.getElementById('errorModal').style.display = 'none';
        });
    }

    // Payment instructions modal close buttons
    const closePaymentInstructionsBtn = document.getElementById('closePaymentInstructionsBtn');
    if (closePaymentInstructionsBtn) {
        closePaymentInstructionsBtn.addEventListener('click', () => {
            closePaymentInstructionsModal();
        });
    }

    const closePaymentInstructionsBtn2 = document.getElementById('closePaymentInstructionsBtn2');
    if (closePaymentInstructionsBtn2) {
        closePaymentInstructionsBtn2.addEventListener('click', () => {
            closePaymentInstructionsModal();
        });
    }

    // Real-time validation
    setupFormValidation();
}

// Setup real-time form validation
function setupFormValidation() {
    const inputs = document.querySelectorAll('.form-input');
    inputs.forEach(input => {
        input.addEventListener('blur', () => validateField(input));
        input.addEventListener('input', () => clearFieldError(input));
    });
}

// Validate individual field
function validateField(field) {
    const fieldName = field.name;
    const value = field.value.trim();
    const errorElement = document.getElementById(fieldName + 'Error');

    clearFieldError(field);

    switch (fieldName) {
        case 'fullName':
            if (value.length < 2) {
                showFieldError(field, 'Name must be at least 2 characters');
                return false;
            }
            break;
        case 'phone':
            const phoneRegex = /^(\+260|0)?[0-9]{9}$/;
            if (!phoneRegex.test(value.replace(/\s/g, ''))) {
                showFieldError(field, 'Please enter a valid phone number');
                return false;
            }
            break;
        case 'email':
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
                showFieldError(field, 'Please enter a valid email address');
                return false;
            }
            break;
        case 'deliveryAddress':
            if (value.length < 5) {
                showFieldError(field, 'Please enter a valid address');
                return false;
            }
            break;
        case 'city':
            if (value.length < 2) {
                showFieldError(field, 'Please enter a valid city');
                return false;
            }
            break;
        case 'province':
            if (!value) {
                showFieldError(field, 'Please select a province');
                return false;
            }
            break;
        case 'mobileProvider':
            if (!value) {
                showFieldError(field, 'Please select a mobile money provider');
                return false;
            }
            break;
        case 'paymentPhone':
            const paymentPhoneRegex = /^(\+260|0)?[0-9]{9}$/;
            if (!paymentPhoneRegex.test(value.replace(/\s/g, ''))) {
                showFieldError(field, 'Please enter a valid phone number');
                return false;
            }
            // Validate phone matches provider if provider is selected
            const mobileProvider = document.getElementById('mobileProvider');
            if (mobileProvider && mobileProvider.value) {
                if (!validatePaymentPhone()) {
                    return false;
                }
            }
            break;
        case 'bankName':
            if (!value) {
                showFieldError(field, 'Please select a bank');
                return false;
            }
            break;
    }

    return true;
}

// Show field error
function showFieldError(field, message) {
    const errorElement = document.getElementById(field.name + 'Error');
    if (errorElement) {
        errorElement.textContent = message;
    }
    field.style.borderColor = '#ff4444';
}

// Clear field error
function clearFieldError(field) {
    const errorElement = document.getElementById(field.name + 'Error');
    if (errorElement) {
        errorElement.textContent = '';
    }
    field.style.borderColor = 'rgba(255, 238, 193, 0.3)';
}

// Validate payment phone number matches selected provider
function validatePaymentPhone() {
    const mobileProvider = document.getElementById('mobileProvider');
    const paymentPhone = document.getElementById('paymentPhone');

    if (!mobileProvider || !paymentPhone || !mobileProvider.value || !paymentPhone.value) {
        return true; // Don't validate if fields are empty
    }

    const phone = paymentPhone.value.replace(/\s/g, '');
    const provider = mobileProvider.value.toLowerCase();

    // Phone number prefixes for Zambian networks (corrected)
    const networkPrefixes = {
        'airtel': ['097', '077', '057'],  // Airtel Zambia: 097x, 077x, 057x
        'mtn': ['096', '076'],            // MTN Zambia: 096x, 076x
        // Zamtel disabled
    };

    // Remove country code if present, but keep leading 0
    let phoneToCheck = phone.replace(/^\+260/, '');

    // If no leading 0, add it for consistency (Zambian numbers typically have 0)
    if (!phoneToCheck.startsWith('0') && phoneToCheck.length === 9) {
        phoneToCheck = '0' + phoneToCheck;
    }

    // Get the first 3 digits (including the leading 0)
    const firstThreeDigits = phoneToCheck.substring(0, 3);

    // Check if phone number starts with provider's prefix
    const prefixes = networkPrefixes[provider] || [];

    if (prefixes.length > 0) {
        // Check if the number starts with any of the provider's prefixes
        const matchesProvider = prefixes.some(prefix => firstThreeDigits === prefix);

        if (!matchesProvider) {
            const providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
            const validPrefixes = prefixes.join(', ');
            showFieldError(paymentPhone, `This number doesn't appear to be a ${providerName} number. ${providerName} numbers start with: ${validPrefixes}`);
            return false;
        }
    }

    clearFieldError(paymentPhone);
    return true;
}

// Calculate delivery fee - Always free
function calculateDeliveryFee() {
    // Always set delivery fee to 0 (free shipping)
    deliveryFee = 0;

    const deliveryFeeDisplay = document.getElementById('deliveryFeeDisplay');
    if (deliveryFeeDisplay) {
        deliveryFeeDisplay.style.display = 'none';
    }

    updateOrderSummary();
}

// Get province element (for pickup option toggle)
function getProvinceElement() {
    return document.getElementById('province');
}

// Update order summary
function updateOrderSummary() {
    const summaryItems = document.getElementById('summaryItems');
    const summarySubtotal = document.getElementById('summarySubtotal');
    const summaryDelivery = document.getElementById('summaryDelivery');
    const summaryTotal = document.getElementById('summaryTotal');

    // Clear existing items
    summaryItems.innerHTML = '';

    // Use server-validated totals if available (prevents price manipulation)
    let subtotal = 0;
    let total = 0;

    if (window.serverValidatedTotals) {
        // Use authoritative server-calculated totals
        subtotal = window.serverValidatedTotals.subtotal || 0;
        deliveryFee = window.serverValidatedTotals.delivery || deliveryFee;
        total = window.serverValidatedTotals.total || 0;
    } else {
        // Fallback: calculate from items (should not happen if validation ran)
        checkoutCartItems.forEach(item => {
            // Handle price - can be number or string with 'K' prefix
            let price = 0;
            if (typeof item.price === 'number') {
                price = item.price;
            } else if (typeof item.price === 'string') {
                price = parseFloat(item.price.replace(/[K,]/g, '')) || 0;
            }

            const quantity = item.quantity || 1;
            subtotal += price * quantity;
        });
        total = subtotal + deliveryFee;
    }

    // Render items
    checkoutCartItems.forEach(item => {
        // Handle price - can be number or string with 'K' prefix
        let price = 0;
        if (typeof item.price === 'number') {
            price = item.price;
        } else if (typeof item.price === 'string') {
            price = parseFloat(item.price.replace(/[K,]/g, '')) || 0;
        }

        const quantity = item.quantity || 1;

        // Add item to summary
        const itemDiv = document.createElement('div');
        itemDiv.className = 'summary-item';
        itemDiv.innerHTML = `
            <img src="${item.image || '/images/placeholder.jpg'}" alt="${item.name}" class="summary-item-image">
            <div class="summary-item-info">
                <div class="summary-item-name">${escapeHtml(item.name)}</div>
                <div class="summary-item-details">Qty: ${quantity}</div>
                <div class="summary-item-price">K${(price * quantity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
        `;
        summaryItems.appendChild(itemDiv);
    });

    // Update display with server-validated totals
    summarySubtotal.textContent = `K${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    summaryDelivery.textContent = deliveryFee > 0 ? `K${deliveryFee.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Free';
    summaryTotal.innerHTML = `<strong>K${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>`;
}

// Handle form submission
async function handleFormSubmit(e) {
    e.preventDefault();

    // Validate all fields
    const form = e.target;
    const formData = new FormData(form);
    let isValid = true;

    // Get payment method
    const paymentMethod = formData.get('paymentMethod');

    // Validate payment method is selected
    if (!paymentMethod) {
        isValid = false;
        // Show error on payment method section
        const paymentMethodError = document.getElementById('paymentMethodError');
        if (paymentMethodError) {
            paymentMethodError.textContent = 'Please select a payment method';
        } else {
            // Create error element if it doesn't exist
            const paymentMethodsContainer = document.querySelector('.payment-methods');
            if (paymentMethodsContainer) {
                const errorElement = document.createElement('span');
                errorElement.id = 'paymentMethodError';
                errorElement.className = 'error-message';
                errorElement.textContent = 'Please select a payment method';
                errorElement.style.display = 'block';
                errorElement.style.marginTop = '10px';
                paymentMethodsContainer.appendChild(errorElement);
            }
        }
        // Highlight payment method options
        const paymentOptions = document.querySelectorAll('input[name="paymentMethod"]');
        paymentOptions.forEach(option => {
            option.style.outline = '2px solid #ff4444';
        });
    } else {
        // Clear error if payment method is selected
        const paymentMethodError = document.getElementById('paymentMethodError');
        if (paymentMethodError) {
            paymentMethodError.textContent = '';
        }
        const paymentOptions = document.querySelectorAll('input[name="paymentMethod"]');
        paymentOptions.forEach(option => {
            option.style.outline = '';
        });
    }

    // Validate payment method specific fields
    if (paymentMethod === 'mobile' || paymentMethod === 'mobile_money') {
        const mobileProvider = document.getElementById('mobileProvider');
        const paymentPhone = document.getElementById('paymentPhone');

        if (!mobileProvider || !mobileProvider.value) {
            isValid = false;
            showFieldError(mobileProvider, 'Please select a mobile money provider');
        }

        if (!paymentPhone || !paymentPhone.value) {
            isValid = false;
            showFieldError(paymentPhone, 'Please enter your mobile money number');
        } else if (!validateField(paymentPhone)) {
            isValid = false;
        }
    }
    // Bank Transfer validation - DISABLED FOR NOW (Will be enabled in future update)
    /*
    else if (paymentMethod === 'bank' || paymentMethod === 'bank_transfer') {
        const bankName = document.getElementById('bankName');
        if (!bankName || !bankName.value) {
            isValid = false;
            showFieldError(bankName, 'Please select a bank');
        }
    }
    */

    // Validate required fields (paymentMethod is validated separately above)
    const requiredFields = ['fullName', 'phone', 'email', 'deliveryAddress', 'province', 'city', 'acceptTerms'];

    requiredFields.forEach(fieldName => {
        const field = document.getElementById(fieldName);
        if (field) {
            if (field.type === 'checkbox') {
                if (!field.checked) {
                    isValid = false;
                    showFieldError(field, 'This field is required');
                }
            } else {
                if (!validateField(field)) {
                    isValid = false;
                }
            }
        }
    });

    if (!isValid) {
        return;
    }

    // Disable submit button
    const placeOrderBtn = document.getElementById('placeOrderBtn');
    placeOrderBtn.disabled = true;
    placeOrderBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    // Show payment processing modal
    document.getElementById('paymentModal').style.display = 'flex';

    try {
        // Validate cart items before proceeding
        if (!checkoutCartItems || !Array.isArray(checkoutCartItems) || checkoutCartItems.length === 0) {
            throw new Error('Your cart is empty. Please add items before checkout.');
        }

        // Cart and totals were validated in loadCartItems() (POST /api/cart/validate).
        // Order creation still validates server-side; skipping a second validate here avoids redundant latency.
        const validatedItems = checkoutCartItems;
        let validatedTotals = window.serverValidatedTotals;
        if (!validatedTotals) {
            let subtotalCalc = 0;
            for (const item of checkoutCartItems) {
                const p = typeof item.price === 'number'
                    ? item.price
                    : parseFloat(String(item.price).replace(/[K,]/g, '')) || 0;
                subtotalCalc += p * (item.quantity || 1);
            }
            validatedTotals = {
                subtotal: subtotalCalc,
                discount: 0,
                delivery: deliveryFee,
                total: subtotalCalc + deliveryFee
            };
        }

        // Prepare order data with server-validated prices
        const checkoutModeRadio = document.querySelector('input[name="checkoutMode"]:checked');
        const checkoutMode = checkoutModeRadio ? checkoutModeRadio.value : 'standard';

        const orderData = {
            customer: {
                name: formData.get('fullName'),
                phone: formData.get('phone'),
                email: formData.get('email'),
                createAccount: formData.get('createAccount') === 'on'
            },
            shipping: {
                address: formData.get('deliveryAddress'),
                province: formData.get('province'),
                city: formData.get('city'),
                instructions: formData.get('deliveryInstructions') || '',
                pickup: document.getElementById('pickupOption').checked
            },
            paymentMethod: ({ mobile: 'mobile_money', bank: 'bank_transfer' })[paymentMethod] || paymentMethod,
            items: validatedItems, // Use server-validated items
            totals: validatedTotals, // Use server-validated totals
            checkoutMode
        };

        if (checkoutMode === 'layby') {
            const dep = document.getElementById('laybyDepositPercent');
            orderData.laybyDepositPercent = dep ? dep.value : '30';
        }

        // Debug: Log order data to verify structure
        console.log('[Checkout] Order data being sent:', {
            paymentMethod: orderData.paymentMethod,
            province: orderData.shipping.province,
            city: orderData.shipping.city,
            pickup: orderData.shipping.pickup,
            itemsCount: orderData.items ? orderData.items.length : 0
        });

        // Process order with Lenco payment
        const response = await processOrderWithLenco(orderData, formData);

        // Hide processing modal
        document.getElementById('paymentModal').style.display = 'none';

        if (response.success) {
            if (response.paymentStatus === 'pending') {
                // Payment initiated but pending - show payment instructions
                showPaymentInstructionsModal(response);
                // Start polling payment status
                startPaymentPolling(response.transactionId || response.reference);
            } else if (response.paymentStatus === 'completed') {
                // Payment completed immediately (unlikely but possible)
                handlePaymentSuccess(response.orderNumber);
            } else {
                // Payment failed
                throw new Error(response.message || 'Payment processing failed');
            }
        } else {
            throw new Error(response.message || 'Order processing failed');
        }
    } catch (error) {
        console.error('Order processing error:', error);

        // Hide processing modal
        document.getElementById('paymentModal').style.display = 'none';

        // Stop polling if active
        stopPaymentPolling();

        // Show error modal
        document.getElementById('errorMessage').textContent = error.message || 'There was an error processing your order. Please try again.';
        document.getElementById('errorModal').style.display = 'flex';

        // Re-enable submit button
        placeOrderBtn.disabled = false;
        placeOrderBtn.innerHTML = '<i class="fas fa-lock"></i> Place Order';
    }
}

// Process order with Lenco payment
async function processOrderWithLenco(orderData, formData) {
    try {
        // Step 1: Create order
        const orderResponse = await fetch('/api/orders/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : ''
            },
            body: JSON.stringify(orderData)
        });

        const orderResult = await orderResponse.json();

        if (!orderResult.success) {
            // Show detailed validation errors if available
            let errorMessage = orderResult.message || 'Failed to create order';
            if (orderResult.errors && Array.isArray(orderResult.errors) && orderResult.errors.length > 0) {
                errorMessage += ': ' + orderResult.errors.join(', ');
            }
            throw new Error(errorMessage);
        }

        const orderNumber = orderResult.orderNumber;

        // Step 2: Prepare payment data based on payment method
        // NOTE: amount is intentionally omitted — the server always fetches the
        // authoritative total from the database using orderNumber. Sending a
        // client-supplied amount creates a misleading API contract and becomes a
        // vulnerability if the server-side guard is ever weakened.
        const paymentMethod = orderData.paymentMethod;
        const paymentData = {
            orderNumber: orderNumber,
            paymentMethod: paymentMethod,
            customerInfo: orderData.customer,
            orderData: orderData // Include full order data for Lenco
        };

        if (orderResult.laybyPaymentId) {
            paymentData.laybyPaymentId = orderResult.laybyPaymentId;
        }

        // Add payment method specific data
        if (paymentMethod === 'mobile_money') {
            const provider = formData.get('mobileProvider');
            const paymentPhone = formData.get('paymentPhone'); // Use payment phone, not contact phone

            if (!provider) {
                throw new Error('Mobile money provider is required');
            }
            if (!paymentPhone) {
                throw new Error('Mobile money number is required for payment');
            }

            paymentData.provider = provider;
            paymentData.customerPhone = paymentPhone; // Use the payment phone number
        }
        // Bank Transfer - DISABLED FOR NOW (Will be enabled in future update)
        /*
        else if (paymentMethod === 'bank_transfer') {
            const bankName = formData.get('bankName');
            
            if (!bankName) {
                throw new Error('Bank name is required');
            }
            
            paymentData.bankDetails = {
                bankName: bankName,
                accountName: orderData.customer.name
            };
        }
        */

        // Step 3: Initiate payment with Lenco
        const paymentResponse = await fetch('/api/payments/process', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : ''
            },
            body: JSON.stringify(paymentData)
        });

        const paymentResult = await paymentResponse.json();

        if (!paymentResult.success) {
            // Payment failed - order is created but payment failed
            return {
                success: false,
                orderNumber: orderNumber,
                message: paymentResult.message || 'Payment processing failed',
                retryable: paymentResult.retryable || false
            };
        }

        // Payment initiated successfully
        return {
            success: true,
            orderNumber: orderNumber,
            transactionId: paymentResult.transactionId,
            reference: paymentResult.reference,
            paymentStatus: paymentResult.status || 'pending',
            paymentInstructions: paymentResult.paymentInstructions,
            qrCode: paymentResult.qrCode,
            paymentUrl: paymentResult.paymentUrl,
            bankAccount: paymentResult.bankAccount,
            expiresAt: paymentResult.expiresAt,
            message: paymentResult.message || 'Payment initiated successfully'
        };
    } catch (error) {
        console.error('Order processing error:', error);
        throw error;
    }
}

// Show payment instructions modal
function showPaymentInstructionsModal(paymentData) {
    // Get payment instructions modal from template
    const modal = document.getElementById('paymentInstructionsModal');
    if (!modal) {
        console.error('Payment instructions modal not found');
        return;
    }

    // Update payment reference
    const referenceCode = modal.querySelector('.reference-code');
    if (referenceCode) {
        referenceCode.textContent = paymentData.reference || paymentData.transactionId || 'N/A';
    }

    // Show/hide QR code section
    const qrCodeSection = modal.querySelector('.qr-code-section');
    const qrCodeImage = modal.querySelector('.qr-code-image');
    if (paymentData.qrCode && qrCodeSection && qrCodeImage) {
        qrCodeImage.src = paymentData.qrCode;
        qrCodeSection.style.display = 'block';
    } else if (qrCodeSection) {
        qrCodeSection.style.display = 'none';
    }

    // Show/hide payment URL section
    const paymentUrlSection = modal.querySelector('.payment-url-section');
    const paymentLinkBtn = modal.querySelector('.payment-link-btn');
    if (paymentData.paymentUrl && paymentUrlSection && paymentLinkBtn) {
        paymentLinkBtn.href = paymentData.paymentUrl;
        paymentUrlSection.style.display = 'block';
    } else if (paymentUrlSection) {
        paymentUrlSection.style.display = 'none';
    }

    // Show/hide payment instructions text
    const instructionsSection = modal.querySelector('.payment-instructions-text');
    const instructionsContent = modal.querySelector('.instructions-content');
    if (paymentData.paymentInstructions && instructionsSection && instructionsContent) {
        instructionsContent.textContent = paymentData.paymentInstructions;
        instructionsSection.style.display = 'block';
    } else if (instructionsSection) {
        instructionsSection.style.display = 'none';
    }

    // Show/hide bank account section
    const bankAccountSection = modal.querySelector('.bank-account-section');
    const bankDetails = modal.querySelector('.bank-details');
    if (paymentData.bankAccount && bankAccountSection && bankDetails) {
        const acct = paymentData.bankAccount;
        const orderNumber = paymentData.orderNumber || 'N/A';

        let bankDetailsHtml = `
            <div style="display: grid; gap: 8px;">
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">Bank Name:</span>
                    <strong>${escapeHtml(acct.bankName || '—')}</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">Account Number:</span>
                    <strong style="font-family: monospace;">${escapeHtml(acct.accountNumber || '—')}</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">Account Name:</span>
                    <strong>${escapeHtml(acct.accountName || '—')}</strong>
                </div>
        `;

        if (acct.branchCode) {
            bankDetailsHtml += `
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #64748b;">Branch Code:</span>
                    <strong>${escapeHtml(acct.branchCode)}</strong>
                </div>
            `;
        }

        bankDetailsHtml += `
            </div>
            <p style="margin: 12px 0 0; font-size: 13px; color: #f59e0b; font-weight: 600;">
                ⚠️ Use your Order Number <strong>${escapeHtml(orderNumber)}</strong> as payment reference
            </p>
        `;

        bankDetails.innerHTML = bankDetailsHtml;
        bankAccountSection.style.display = 'block';
    } else if (bankAccountSection) {
        bankAccountSection.style.display = 'none';
    }

    // Show/hide payment expiry
    const paymentExpiry = modal.querySelector('.payment-expiry');
    const paymentExpiryTime = modal.querySelector('#paymentExpiryTime');
    if (paymentData.expiresAt && paymentExpiry && paymentExpiryTime) {
        paymentExpiryTime.textContent = new Date(paymentData.expiresAt).toLocaleString();
        paymentExpiry.style.display = 'block';
    } else if (paymentExpiry) {
        paymentExpiry.style.display = 'none';
    }

    // Show modal
    modal.style.display = 'flex';

    // Form + payment modal: pending (polling handles the rest)
    updatePaymentStatusIndicator('pending', 'Waiting for payment confirmation...');
    syncPaymentInstructionModal(
        'pending',
        'Complete the payment on your phone if prompted. This screen updates automatically—you don’t need to refresh or tap anything else.'
    );
}

function normalizePaymentVisualStatus(status) {
    if (status === undefined || status === null || status === '') return 'hidden';
    const n = String(status).toLowerCase();
    if (['completed', 'successful', 'success', 'paid', 'succeeded'].includes(n)) return 'completed';
    if (n === 'failed') return 'failed';
    if (n === 'cancelled' || n === 'canceled') return 'hidden';
    return 'pending';
}

function syncPaymentInstructionModal(visual, message) {
    const wrap = document.getElementById('paymentModalAutoConfirm');
    if (!wrap) return;

    if (visual === 'hidden') {
        wrap.style.display = 'none';
        wrap.classList.remove(
            'payment-modal-auto-confirm--pending',
            'payment-modal-auto-confirm--success',
            'payment-modal-auto-confirm--failed'
        );
        return;
    }

    wrap.style.display = 'flex';
    wrap.classList.remove(
        'payment-modal-auto-confirm--pending',
        'payment-modal-auto-confirm--success',
        'payment-modal-auto-confirm--failed'
    );

    const iconSlot = document.querySelector('#paymentModalStatusIcon i');
    const titleEl = document.getElementById('paymentModalStatusTitle');
    const detailEl = document.getElementById('paymentModalStatusDetail');
    if (!titleEl || !detailEl || !iconSlot) return;

    if (visual === 'completed') {
        wrap.classList.add('payment-modal-auto-confirm--success');
        iconSlot.className = 'fas fa-check-circle';
        titleEl.textContent = 'Payment confirmed';
        detailEl.textContent = message || 'Redirecting…';
    } else if (visual === 'failed') {
        wrap.classList.add('payment-modal-auto-confirm--failed');
        iconSlot.className = 'fas fa-times-circle';
        titleEl.textContent = 'Payment not completed';
        detailEl.textContent = message || 'Please try again or contact support.';
    } else {
        wrap.classList.add('payment-modal-auto-confirm--pending');
        iconSlot.className = 'fas fa-circle-notch fa-spin';
        titleEl.textContent = 'Confirming your payment';
        detailEl.textContent =
            message ||
            'Complete the payment on your phone if prompted. This screen updates automatically—you don’t need to refresh or tap anything else.';
    }
}

// Update payment status indicator (checkout form) and mirror state in the payment-instructions modal
function updatePaymentStatusIndicator(status, message) {
    const visual = normalizePaymentVisualStatus(status);
    const indicator = document.getElementById('paymentStatusIndicator');
    const statusText = document.getElementById('paymentStatusText');
    const resolvedMsg =
        message ||
        (visual === 'pending'
            ? getStatusMessage(String(status || 'pending').toLowerCase())
            : visual === 'completed'
              ? 'Payment confirmed!'
              : visual === 'failed'
                ? 'Payment failed'
                : '');

    if (indicator && statusText) {
        if (visual === 'hidden') {
            indicator.style.display = 'none';
        } else if (visual === 'pending') {
            indicator.style.display = 'block';
            indicator.style.background = 'rgba(59, 130, 246, 0.1)';
            indicator.style.borderLeftColor = '#3b82f6';
            statusText.textContent = resolvedMsg;

            const icon = indicator.querySelector('i');
            if (icon) {
                icon.className = 'fas fa-spinner fa-spin';
                icon.style.color = '#3b82f6';
            }
        } else if (visual === 'completed') {
            indicator.style.display = 'block';
            indicator.style.background = 'rgba(16, 185, 129, 0.1)';
            indicator.style.borderLeftColor = '#10b981';
            statusText.textContent = resolvedMsg;

            const icon = indicator.querySelector('i');
            if (icon) {
                icon.className = 'fas fa-check-circle';
                icon.style.color = '#10b981';
            }
        } else if (visual === 'failed') {
            indicator.style.display = 'block';
            indicator.style.background = 'rgba(239, 68, 68, 0.1)';
            indicator.style.borderLeftColor = '#ef4444';
            statusText.textContent = resolvedMsg;

            const icon = indicator.querySelector('i');
            if (icon) {
                icon.className = 'fas fa-times-circle';
                icon.style.color = '#ef4444';
            }
        }
    }

    syncPaymentInstructionModal(visual, resolvedMsg);
}

// Close payment instructions modal and cancel the pending transaction
function closePaymentInstructionsModal() {
    const modal = document.getElementById('paymentInstructionsModal');
    if (modal) {
        modal.style.display = 'none';
    }

    // Hide the status indicator
    updatePaymentStatusIndicator('cancelled');

    // Cancel the transaction on the server and stop polling
    const txId = currentTransactionId;
    stopPaymentPolling();

    if (txId) {
        const cancelFailedUserMessage =
            "We couldn't cancel the payment request on your phone. You may still receive a prompt — please decline it.";
        fetch(`/api/payments/cancel/${txId}`, { method: 'PATCH' })
            .then(async (response) => {
                if (!response.ok) {
                    let detail = response.statusText || '';
                    try {
                        const body = await response.json();
                        if (body && body.message) detail = body.message;
                    } catch {
                        /* non-JSON body */
                    }
                    console.warn('[Checkout] Payment cancel failed:', response.status, detail);
                    showNotification(cancelFailedUserMessage, 'warning');
                }
            })
            .catch((err) => {
                console.warn('[Checkout] Payment cancel request failed:', err);
                showNotification(cancelFailedUserMessage, 'warning');
            });
    }
}

// Schedule the next poll after the previous one finishes (avoids stacking intervals during 429 backoff)
async function scheduleNextPoll(transactionId) {
    if (currentTransactionId !== transactionId) {
        return;
    }
    if (!paymentPollStartTime) {
        return;
    }

    const elapsed = Date.now() - paymentPollStartTime;
    if (elapsed > PAYMENT_POLL_TIMEOUT) {
        stopPaymentPolling();
        showPaymentTimeoutError();
        return;
    }

    await pollPaymentStatus(transactionId);

    if (currentTransactionId !== transactionId) {
        return;
    }

    const nextDelay = Math.max(PAYMENT_POLL_INTERVAL, rateLimitBackoff);
    console.log(`[Payment Polling] Next poll in ${nextDelay}ms (${nextDelay / 1000}s)`);
    paymentPollInterval = setTimeout(() => scheduleNextPoll(transactionId), nextDelay);
}

// Start payment status polling
function startPaymentPolling(transactionId) {
    if (!transactionId) {
        console.error('Cannot start polling: transactionId is required');
        return;
    }

    // Clear any existing polling first
    stopPaymentPolling();

    // Set start time AFTER clearing previous polling
    currentTransactionId = transactionId;
    paymentPollStartTime = Date.now();
    sessionStorage.setItem(PENDING_TRANSACTION_KEY, transactionId);

    console.log(`[Payment Polling] Starting polling for transaction: ${transactionId}`);
    console.log(`[Payment Polling] Waiting 8 seconds before first check to allow Lenco to create collection...`);
    console.log(`[Payment Polling] Poll start time: ${new Date(paymentPollStartTime).toISOString()}`);
    console.log(`[Payment Polling] Base poll interval: ${PAYMENT_POLL_INTERVAL}ms (${PAYMENT_POLL_INTERVAL / 1000}s)`);

    // Reset backoff when starting new polling
    rateLimitBackoff = 0;

    // IMPORTANT: Wait 8 seconds before first poll
    // Lenco needs time to create the collection record after initiating payment
    // Polling too early causes "Collection details was not found" errors
    paymentPollInterval = setTimeout(() => {
        if (currentTransactionId !== transactionId) {
            console.log(`[Payment Polling] Transaction changed, stopping old polling`);
            return;
        }
        console.log(`[Payment Polling] First poll after ${Date.now() - paymentPollStartTime}ms delay`);
        scheduleNextPoll(transactionId);
    }, 8000);
}

// Poll payment status
async function pollPaymentStatus(transactionId) {
    try {
        // Verify we're still polling the same transaction
        if (currentTransactionId !== transactionId) {
            console.log(`[Payment Polling] Transaction changed during poll, ignoring result`);
            return;
        }

        // Backoff delay is applied via scheduleNextPoll's setTimeout (nextDelay), not here — avoids stacking with fixed intervals

        const response = await fetch(`/api/payments/verify/${transactionId}`);

        // Handle rate limiting (429)
        if (response.status === 429) {
            const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
            rateLimitBackoff = retryAfter * 1000; // Convert to milliseconds
            console.warn(`[Payment Polling] Rate limited. Backing off for ${retryAfter}s. Retry-After: ${retryAfter}s`);

            // Update UI to show we're waiting
            updatePaymentStatusIndicator('pending', 'Checking payment status (rate limited, please wait)...');

            // Continue polling after backoff
            return;
        }

        // Reset backoff on successful request
        rateLimitBackoff = 0;

        const data = await response.json();

        if (data.success) {
            const rawStatus = data.status || data.lencoStatus;
            const statusNorm = String(rawStatus || '').toLowerCase();
            const isPaid =
                statusNorm === 'completed' ||
                statusNorm === 'successful' ||
                statusNorm === 'success' ||
                statusNorm === 'paid' ||
                statusNorm === 'succeeded';

            console.log(`[Payment Polling] Status: ${rawStatus}`, {
                processing: data.processing,
                verified: data.verified,
                message: data.message
            });

            const statusMessage = data.processing
                ? 'Still syncing with the payment provider. Keep this page open—we’ll update automatically.'
                : getStatusMessage(rawStatus);
            updatePaymentStatusIndicator(rawStatus, statusMessage);

            // Handle processing state (collection not yet available in Lenco)
            if (data.processing) {
                console.log(`[Payment Polling] Payment still processing, will check again...`);
                // Continue polling - this is expected when collection isn't ready yet
                return;
            }

            if (isPaid || data.status === 'completed') {
                // Payment completed (treat Lenco success variants as done)
                console.log(`[Payment Polling] Payment completed!`);
                stopPaymentPolling();
                handlePaymentSuccess(data.orderNumber || 'N/A');
            } else if (statusNorm === 'failed' || statusNorm === 'cancelled' || statusNorm === 'canceled') {
                // Payment failed
                console.log(`[Payment Polling] Payment failed: ${rawStatus}`);
                stopPaymentPolling();
                showPaymentFailedError(data.failureReason || 'Payment failed');
            } else {
                // Status is pending/processing - continue polling
                console.log(`[Payment Polling] Payment ${rawStatus}, continuing to poll...`);
            }
        } else {
            console.error('[Payment Polling] Error verifying payment:', data.message);
            updatePaymentStatusIndicator(
                'pending',
                data.message || 'Checking payment status… We’ll keep trying automatically.'
            );
            // Continue polling on error (might be temporary)
        }
    } catch (error) {
        console.error('[Payment Polling] Error:', error);
        updatePaymentStatusIndicator(
            'pending',
            'Connection issue. Retrying payment status automatically…'
        );
        // Continue polling on error (might be temporary)
    }
}

// Get status message for payment status
function getStatusMessage(status) {
    const key = String(status || '').toLowerCase();
    const messages = {
        pending: 'Waiting for payment confirmation...',
        processing: 'Payment is being processed...',
        completed: 'Payment confirmed!',
        successful: 'Payment confirmed!',
        success: 'Payment confirmed!',
        paid: 'Payment confirmed!',
        succeeded: 'Payment confirmed!',
        failed: 'Payment failed',
        cancelled: 'Payment cancelled',
        canceled: 'Payment cancelled'
    };
    return messages[key] || 'Checking payment status...';
}

// Stop payment polling
function stopPaymentPolling() {
    if (paymentPollInterval) {
        clearTimeout(paymentPollInterval);
        paymentPollInterval = null;
    }
    currentTransactionId = null;
    paymentPollStartTime = null;
    rateLimitBackoff = 0; // Reset backoff when stopping
    sessionStorage.removeItem(PENDING_TRANSACTION_KEY);
}

// Handle payment success
function handlePaymentSuccess(orderNumber) {
    // Stop polling
    stopPaymentPolling();

    // Close payment instructions modal
    closePaymentInstructionsModal();

    // Clear cart
    localStorage.removeItem('cart');

    // Redirect to order success page
    window.location.href = `/order-success/${orderNumber}`;
}

// Show payment timeout error
function showPaymentTimeoutError() {
    stopPaymentPolling();
    closePaymentInstructionsModal();

    document.getElementById('errorMessage').textContent =
        'Payment timeout. Your order has been created but payment is still pending. Please contact support or try again.';
    document.getElementById('errorModal').style.display = 'flex';
}

// Show payment failed error
function showPaymentFailedError(reason) {
    stopPaymentPolling();
    closePaymentInstructionsModal();

    document.getElementById('errorMessage').textContent =
        `Payment failed: ${reason || 'Please try again'}`;
    document.getElementById('errorModal').style.display = 'flex';
}

// Calculate subtotal
function calculateSubtotal() {
    return checkoutCartItems.reduce((sum, item) => {
        // Handle price - can be number or string with 'K' prefix
        let price = 0;
        if (typeof item.price === 'number') {
            price = item.price;
        } else if (typeof item.price === 'string') {
            price = parseFloat(item.price.replace(/[K,]/g, '')) || 0;
        }
        const quantity = item.quantity || 1;
        return sum + (price * quantity);
    }, 0);
}

// Calculate discount
function calculateDiscount() {
    return 0;
}

// Show notification
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#28a745' : type === 'warning' ? '#ffc107' : '#dc3545'};
        color: white;
        padding: 15px 25px;
        border-radius: 5px;
        font-weight: 600;
        z-index: 10000;
        animation: slideInRight 0.3s ease;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        max-width: 400px;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, type === 'error' ? 5000 : 3000);
}

// Calculate total
function calculateTotal() {
    const subtotal = calculateSubtotal();
    return subtotal + deliveryFee;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Load banks from API with fallback
async function loadBanks() {
    const bankSelect = document.getElementById('bankName');
    const loadingSpinner = document.getElementById('bankLoadingSpinner');
    if (!bankSelect) return;

    // Show loading spinner
    if (loadingSpinner) {
        loadingSpinner.style.display = 'block';
    }
    bankSelect.disabled = true;

    try {
        const response = await fetch('/api/payments/banks');
        const data = await response.json();

        if (data.success && data.banks && data.banks.length > 0) {
            // Clear loading option
            bankSelect.innerHTML = '<option value="">-- Select Bank --</option>';

            // Add banks from API
            data.banks.forEach(bank => {
                const option = document.createElement('option');
                option.value = bank.name;  // Use bank name as value
                option.textContent = bank.name;
                option.dataset.code = bank.code; // Store code for reference
                bankSelect.appendChild(option);
            });

            // Hide loading spinner and enable select
            if (loadingSpinner) {
                loadingSpinner.style.display = 'none';
            }
            bankSelect.disabled = false;

            console.log(`✅ Loaded ${data.banks.length} banks${data.cached ? ' (cached)' : ''}`);
        } else {
            // Fallback to hardcoded list if API fails
            loadFallbackBanks();
        }
    } catch (error) {
        console.error('Error loading banks:', error);
        // Fallback to hardcoded list if API fails
        loadFallbackBanks();
    }
}

// Fallback banks list (used if API fails)
function loadFallbackBanks() {
    const bankSelect = document.getElementById('bankName');
    const loadingSpinner = document.getElementById('bankLoadingSpinner');
    if (!bankSelect) return;

    const fallbackBanks = [
        'Zanaco',
        'First National Bank (FNB)',
        'Stanbic Bank',
        'Standard Chartered',
        'Atlas Mara',
        'Absa',
        'Indo Zambia Bank',
        'Bank of China',
        'Other'
    ];

    bankSelect.innerHTML = '<option value="">-- Select Bank --</option>';
    fallbackBanks.forEach(bankName => {
        const option = document.createElement('option');
        option.value = bankName;
        option.textContent = bankName;
        bankSelect.appendChild(option);
    });

    // Hide loading spinner and enable select
    if (loadingSpinner) {
        loadingSpinner.style.display = 'none';
    }
    bankSelect.disabled = false;

    console.warn('⚠️ Using fallback banks list (API unavailable)');
}
