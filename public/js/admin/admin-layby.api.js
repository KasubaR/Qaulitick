// Admin Layby API — /api/admin/layby (CSRF + auth via auth-utils fetch interceptor)

(function (window) {
    const BASE = '/api/admin/layby';

    /**
     * @param {string} url
     * @param {RequestInit} options
     * @param {number} retries
     */
    async function apiRequest(url, options = {}, retries = 2) {
        const response = await fetch(url, {
            credentials: 'include',
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 429 && retries > 0) {
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, 3 - retries) * 1000;
            await new Promise((r) => setTimeout(r, delay));
            return apiRequest(url, options, retries - 1);
        }

        if (!response.ok || data.success === false) {
            const message = data.message || 'Layby API request failed';
            const err = new Error(message);
            err.status = response.status;
            err.data = data;
            throw err;
        }

        return data;
    }

    /**
     * @param {{ page?: number, limit?: number, status?: string, search?: string }} filters
     */
    async function listPlans(filters = {}) {
        const q = new URLSearchParams();
        if (filters.page) q.set('page', String(filters.page));
        if (filters.limit) q.set('limit', String(filters.limit));
        if (filters.status) q.set('status', filters.status);
        if (filters.search) q.set('search', filters.search);
        const qs = q.toString();
        const url = qs ? `${BASE}/plans?${qs}` : `${BASE}/plans`;
        return apiRequest(url, { method: 'GET' });
    }

    /**
     * @param {number} planId
     */
    async function getPlan(planId) {
        return apiRequest(`${BASE}/plans/${planId}`, { method: 'GET' });
    }

    /**
     * @param {number} planId
     * @param {'active'|'completed'|'cancelled'} status
     */
    async function updatePlanStatus(planId, status) {
        return apiRequest(`${BASE}/plans/${planId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status })
        });
    }

    /**
     * @param {number} installmentId
     */
    async function confirmInstallmentOffline(installmentId) {
        return apiRequest(`${BASE}/installments/${installmentId}/confirm-offline`, {
            method: 'POST',
            body: JSON.stringify({})
        });
    }

    window.AdminLaybyAPI = {
        listPlans,
        getPlan,
        updatePlanStatus,
        confirmInstallmentOffline
    };
})(window);
