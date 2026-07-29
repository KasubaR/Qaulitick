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

        let data = {};
        let rawText = '';
        try {
            rawText = await response.text();
            data = JSON.parse(rawText);
        } catch (_) { /* non-JSON response — data stays {} */ }

        if (response.status === 429 && retries > 0) {
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, 3 - retries) * 1000;
            await new Promise((r) => setTimeout(r, delay));
            return apiRequest(url, options, retries - 1);
        }

        if (!response.ok || data.success === false) {
            const message = data.message || `Server error ${response.status}: ${rawText.slice(0, 100)}`;
            const err = new Error(message);
            err.status = response.status;
            if (typeof data.message === 'string' && data.message) {
                err.serverMessage = data.message;
            }
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

    /**
     * Exports layby plans matching the given filters as a file download.
     * @param {'pdf'|'xlsx'|'docx'} format
     * @param {{ status?: string, search?: string }} filters
     */
    async function exportPlans(format, filters = {}) {
        const q = new URLSearchParams();
        q.set('format', format);
        if (filters.status) q.set('status', filters.status);
        if (filters.search) q.set('search', filters.search);

        const response = await fetch(`${BASE}/export?${q.toString()}`, {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || `Failed to export layby plans (${response.status})`);
        }

        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `layby_plans_${new Date().toISOString().split('T')[0]}.${format}`;
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?([^"]+)"?/);
            if (match) filename = match[1];
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

        return { filename };
    }

    window.AdminLaybyAPI = {
        listPlans,
        getPlan,
        updatePlanStatus,
        confirmInstallmentOffline,
        exportPlans
    };
})(window);
