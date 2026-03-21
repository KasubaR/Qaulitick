// Admin Login Page JavaScript

document.addEventListener('DOMContentLoaded', () => {
    initializeLoginPage();
});

/**
 * Initialize login page
 */
function initializeLoginPage() {
    setupFormValidation();
    setupFormSubmission();
    setupPasswordToggle();
    setupAutoHideAlerts();
    setupEnterKeySubmit();
}

/**
 * Setup client-side form validation
 */
function setupFormValidation() {
    const form = document.getElementById('loginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');

    // Email validation
    emailInput.addEventListener('blur', () => {
        validateEmail();
    });

    emailInput.addEventListener('input', () => {
        clearFieldError('email');
    });

    // Password validation
    passwordInput.addEventListener('blur', () => {
        validatePassword();
    });

    passwordInput.addEventListener('input', () => {
        clearFieldError('password');
    });

    // Form validation on submit
    form.addEventListener('submit', (e) => {
        if (!validateForm()) {
            e.preventDefault();
            return false;
        }
    });
}

/**
 * Trim leading/trailing spaces so pasted credentials submit cleanly
 */
function trimLoginFields() {
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    if (emailInput) emailInput.value = emailInput.value.trim();
    if (passwordInput) passwordInput.value = passwordInput.value.trim();
}

/**
 * Validate email field
 * @returns {boolean} True if valid, false otherwise
 */
function validateEmail() {
    const emailInput = document.getElementById('email');
    if (emailInput) emailInput.value = emailInput.value.trim();
    const email = emailInput.value;
    const emailError = document.getElementById('emailError');

    if (!email) {
        showFieldError('email', 'Email is required');
        return false;
    }

    // Email format validation
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
        showFieldError('email', 'Please enter a valid email address');
        return false;
    }

    clearFieldError('email');
    return true;
}

/**
 * Validate password field
 * @returns {boolean} True if valid, false otherwise
 */
function validatePassword() {
    const passwordInput = document.getElementById('password');
    if (passwordInput) passwordInput.value = passwordInput.value.trim();
    const password = passwordInput.value;
    const passwordError = document.getElementById('passwordError');

    if (!password) {
        showFieldError('password', 'Password is required');
        return false;
    }

    if (password.length < 8) {
        showFieldError('password', 'Password must be at least 8 characters long');
        return false;
    }

    clearFieldError('password');
    return true;
}

/**
 * Validate entire form
 * @returns {boolean} True if form is valid, false otherwise
 */
function validateForm() {
    trimLoginFields();
    const isEmailValid = validateEmail();
    const isPasswordValid = validatePassword();

    return isEmailValid && isPasswordValid;
}

/**
 * Show field error message
 * @param {string} fieldName - Field name (email or password)
 * @param {string} message - Error message
 */
function showFieldError(fieldName, message) {
    const input = document.getElementById(fieldName);
    const errorElement = document.getElementById(`${fieldName}Error`);

    if (input) {
        input.classList.add('error');
    }

    if (errorElement) {
        errorElement.textContent = message;
    }
}

/**
 * Clear field error
 * @param {string} fieldName - Field name (email or password)
 */
function clearFieldError(fieldName) {
    const input = document.getElementById(fieldName);
    const errorElement = document.getElementById(`${fieldName}Error`);

    if (input) {
        input.classList.remove('error');
    }

    if (errorElement) {
        errorElement.textContent = '';
    }
}

/**
 * Setup form submission handling
 */
function setupFormSubmission() {
    const form = document.getElementById('loginForm');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoader = document.getElementById('btnLoader');

    form.addEventListener('submit', async (e) => {
        // Client-side validation
        if (!validateForm()) {
            e.preventDefault();
            return false;
        }

        // Show loading state
        submitBtn.disabled = true;
        btnText.style.display = 'none';
        btnLoader.style.display = 'inline-block';

        // Form will submit normally (no preventDefault)
        // Server will handle the actual authentication
    });
}

/**
 * Setup password visibility toggle
 */
function setupPasswordToggle() {
    const passwordToggle = document.getElementById('passwordToggle');
    const passwordInput = document.getElementById('password');
    const passwordToggleIcon = document.getElementById('passwordToggleIcon');

    if (passwordToggle && passwordInput) {
        passwordToggle.addEventListener('click', () => {
            const isPassword = passwordInput.type === 'password';
            
            passwordInput.type = isPassword ? 'text' : 'password';
            
            if (passwordToggleIcon) {
                passwordToggleIcon.classList.toggle('fa-eye', !isPassword);
                passwordToggleIcon.classList.toggle('fa-eye-slash', isPassword);
            }
        });
    }
}

/**
 * Auto-hide alerts after 5 seconds
 */
function setupAutoHideAlerts() {
    const alerts = document.querySelectorAll('.alert');
    
    alerts.forEach(alert => {
        setTimeout(() => {
            alert.style.opacity = '0';
            alert.style.transform = 'translateY(-10px)';
            setTimeout(() => {
                alert.style.display = 'none';
            }, 300);
        }, 5000);
    });
}

/**
 * Setup Enter key to submit form
 */
function setupEnterKeySubmit() {
    const form = document.getElementById('loginForm');
    const inputs = form.querySelectorAll('input');

    inputs.forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                form.dispatchEvent(new Event('submit'));
            }
        });
    });
}

/**
 * Clear all validation errors
 */
function clearAllErrors() {
    clearFieldError('email');
    clearFieldError('password');
}

