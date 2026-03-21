document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('form[action="/login"][method="post"]');
    if (!form) return;

    form.addEventListener('submit', () => {
        const email = document.getElementById('loginEmail');
        const password = document.getElementById('loginPassword');
        if (email) email.value = email.value.trim();
        if (password) password.value = password.value.trim();
    });
});
