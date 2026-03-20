// Contact Page JavaScript
// Form validation, submission handling, and interactive features

(function () {
    'use strict';

    // DOM Elements
    const contactForm = document.getElementById('contactForm');
    const nameInput = document.getElementById('name');
    const emailInput = document.getElementById('email');
    const phoneInput = document.getElementById('phone');
    const subjectSelect = document.getElementById('subject');
    const messageTextarea = document.getElementById('message');
    const submitBtn = contactForm?.querySelector('.submit-btn');

    // Form state
    let isSubmitting = false;

    // Initialize contact page
    function initContactPage() {
        if (!contactForm) return;

        setupFormValidation();
        setupFormSubmission();
        setupInputAnimations();
    }

    // Setup real-time form validation
    function setupFormValidation() {
        // Name validation
        nameInput?.addEventListener('blur', () => validateName());
        nameInput?.addEventListener('input', () => clearError('nameError'));

        // Email validation
        emailInput?.addEventListener('blur', () => validateEmail());
        emailInput?.addEventListener('input', () => clearError('emailError'));

        // Phone validation
        phoneInput?.addEventListener('blur', () => validatePhone());
        phoneInput?.addEventListener('input', () => clearError('phoneError'));

        // Subject validation
        subjectSelect?.addEventListener('change', () => clearError('subjectError'));

        // Message validation
        messageTextarea?.addEventListener('blur', () => validateMessage());
        messageTextarea?.addEventListener('input', () => clearError('messageError'));
    }

    // Validation functions
    function validateName() {
        const name = nameInput?.value.trim();
        const errorEl = document.getElementById('nameError');

        if (!name) {
            showError('nameError', 'Name is required');
            return false;
        }

        if (name.length < 2) {
            showError('nameError', 'Name must be at least 2 characters');
            return false;
        }

        if (name.length > 100) {
            showError('nameError', 'Name must be less than 100 characters');
            return false;
        }

        clearError('nameError');
        return true;
    }

    function validateEmail() {
        const email = emailInput?.value.trim();
        const errorEl = document.getElementById('emailError');
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!email) {
            showError('emailError', 'Email is required');
            return false;
        }

        if (!emailRegex.test(email)) {
            showError('emailError', 'Please enter a valid email address');
            return false;
        }

        clearError('emailError');
        return true;
    }

    function validatePhone() {
        const phone = phoneInput?.value.trim();
        const errorEl = document.getElementById('phoneError');

        // Phone is optional, but if provided, validate Zambian format
        if (!phone) {
            clearError('phoneError');
            return true;
        }

        // Remove spaces, dashes, and parentheses for validation
        const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');

        // Zambian phone number validation
        // Format: +260XXXXXXXXX or 0XXXXXXXXX (9 digits after country code or 0)
        // Mobile: +2609XX or 09XX (starts with 9)
        // Landline: +2602XX or 02XX (starts with 2)
        const zambianPhoneRegex = /^(\+260|0)?[29]\d{8}$/;

        if (!zambianPhoneRegex.test(cleanPhone)) {
            showError('phoneError', 'Please enter a valid Zambian phone number (e.g., +260 977 123 456 or 0977 123 456)');
            return false;
        }

        clearError('phoneError');
        return true;
    }

    function validateMessage() {
        const message = messageTextarea?.value.trim();
        const errorEl = document.getElementById('messageError');

        if (!message) {
            showError('messageError', 'Message is required');
            return false;
        }

        if (message.length < 10) {
            showError('messageError', 'Message must be at least 10 characters');
            return false;
        }

        if (message.length > 2000) {
            showError('messageError', 'Message must be less than 2000 characters');
            return false;
        }

        clearError('messageError');
        return true;
    }

    // Error handling
    function showError(errorId, message) {
        const errorEl = document.getElementById(errorId);
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    function clearError(errorId) {
        const errorEl = document.getElementById(errorId);
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.style.display = 'none';
        }
    }

    // Setup form submission
    function setupFormSubmission() {
        contactForm?.addEventListener('submit', handleFormSubmit);
    }

    // Handle form submission
    async function handleFormSubmit(e) {
        e.preventDefault();

        // Prevent double submission
        if (isSubmitting) {
            return;
        }

        // Validate all fields
        const isNameValid = validateName();
        const isEmailValid = validateEmail();
        const isPhoneValid = validatePhone();
        const isSubjectValid = subjectSelect?.value ? true : (showError('subjectError', 'Please select a subject'), false);
        const isMessageValid = validateMessage();

        if (!isNameValid || !isEmailValid || !isPhoneValid || !isSubjectValid || !isMessageValid) {
            // Scroll to first error
            const firstError = contactForm.querySelector('.error-message:not(:empty)');
            if (firstError) {
                firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }

        // Prepare form data
        const formData = {
            name: nameInput.value.trim(),
            email: emailInput.value.trim(),
            phone: phoneInput.value.trim() || null,
            subject: subjectSelect.value,
            message: messageTextarea.value.trim(),
            timestamp: new Date().toISOString()
        };

        // Disable submit button
        isSubmitting = true;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
        }

        try {
            // In a real application, you would send this to your backend API
            // For now, we'll simulate an API call
            await submitContactForm(formData);

            // Show success message
            showFormSuccess();

            // Reset form
            contactForm.reset();
            clearAllErrors();

            // Show notification
            if (window.showNotification) {
                window.showNotification('Thank you! Your message has been sent successfully.');
            }
        } catch (error) {
            console.error('Form submission error:', error);
            if (window.showNotification) {
                window.showNotification('Failed to send message. Please try again later.');
            }
        } finally {
            // Re-enable submit button
            isSubmitting = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Message';
            }
        }
    }

    // Submit contact form to API
    async function submitContactForm(formData) {
        const response = await fetch('/api/contact', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': typeof window.getCSRFToken === 'function' ? window.getCSRFToken() : ''
            },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (!response.ok) {
            // Handle rate limiting with retry time
            if (response.status === 429 && data.retryAfter) {
                const minutes = Math.ceil(data.retryAfter / 60);
                const seconds = data.retryAfter % 60;
                const timeMessage = minutes > 1
                    ? `Please try again in ${minutes} minutes.`
                    : `Please try again in ${seconds} seconds.`;
                throw new Error(`${data.message || 'Too many requests'} ${timeMessage}`);
            }

            // Handle validation errors
            if (data.errors && Array.isArray(data.errors)) {
                const errorMessage = data.errors.join(', ');
                throw new Error(errorMessage);
            }
            throw new Error(data.message || 'Failed to submit form');
        }

        return data;
    }

    // Show form success message
    function showFormSuccess() {
        // Remove existing success message if any
        const existingSuccess = contactForm.querySelector('.form-success-message');
        if (existingSuccess) {
            existingSuccess.remove();
        }

        // Create success message
        const successMsg = document.createElement('div');
        successMsg.className = 'form-success-message';
        successMsg.innerHTML = '<i class="fas fa-check-circle"></i> Thank you! Your message has been sent successfully. We\'ll get back to you soon.';
        contactForm.insertBefore(successMsg, contactForm.firstChild);

        // Remove success message after 5 seconds
        setTimeout(() => {
            successMsg.remove();
        }, 5000);
    }

    // Clear all error messages
    function clearAllErrors() {
        const errorElements = contactForm.querySelectorAll('.error-message');
        errorElements.forEach(el => {
            el.textContent = '';
            el.style.display = 'none';
        });
    }


    // Setup input animations
    function setupInputAnimations() {
        const inputs = contactForm?.querySelectorAll('input, select, textarea');
        inputs?.forEach(input => {
            // Add focus animation
            input.addEventListener('focus', function () {
                this.parentElement.classList.add('focused');
            });

            input.addEventListener('blur', function () {
                this.parentElement.classList.remove('focused');
            });
        });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initContactPage);
    } else {
        initContactPage();
    }
})();

