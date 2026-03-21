/**
 * Account layby: POST /account/layby/:id/pay then POST /api/payments/process with laybyPaymentId.
 */
(function () {
    const POLL_FIRST_MS = 8000;
    const POLL_INTERVAL_MS = 15000;
    const POLL_TIMEOUT_MS = 15 * 60 * 1000;

    function getCsrf() {
        if (typeof window.getCSRFToken === 'function') {
            return window.getCSRFToken();
        }
        const m = document.querySelector('meta[name="csrf-token"]');
        return m ? m.getAttribute('content') || '' : '';
    }

    function parseCustomer() {
        const el = document.getElementById('account-layby-customer');
        if (!el || !el.textContent.trim()) {
            return { name: '', email: '', phone: '' };
        }
        try {
            return JSON.parse(el.textContent);
        } catch {
            return { name: '', email: '', phone: '' };
        }
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function resetFollowup(block) {
        const wrap = block.querySelector('.account-layby-pay-followup');
        if (!wrap) return;
        wrap.classList.add('account-layby-pay-followup--hidden');
        const text = block.querySelector('.account-layby-pay-followup-text');
        const urlWrap = block.querySelector('.account-layby-pay-url-wrap');
        const link = block.querySelector('.account-layby-pay-url');
        const pre = block.querySelector('.account-layby-pay-instructions');
        if (text) text.textContent = '';
        if (urlWrap) urlWrap.classList.add('account-layby-pay-url-wrap--hidden');
        if (link) link.href = '#';
        if (pre) {
            pre.textContent = '';
            pre.classList.add('account-layby-pay-instructions--hidden');
        }
    }

    function showFollowup(block, paymentResult) {
        const wrap = block.querySelector('.account-layby-pay-followup');
        const text = block.querySelector('.account-layby-pay-followup-text');
        const urlWrap = block.querySelector('.account-layby-pay-url-wrap');
        const link = block.querySelector('.account-layby-pay-url');
        const pre = block.querySelector('.account-layby-pay-instructions');
        if (!wrap) return;
        wrap.classList.remove('account-layby-pay-followup--hidden');
        if (text) {
            const ref = paymentResult.reference || paymentResult.transactionId || '';
            text.textContent = ref
                ? `Reference: ${ref}. Approve the charge on your phone; status updates automatically.`
                : 'Payment started. Approve the charge on your phone; status updates automatically.';
        }
        if (urlWrap && link && paymentResult.paymentUrl) {
            link.href = paymentResult.paymentUrl;
            urlWrap.classList.remove('account-layby-pay-url-wrap--hidden');
        } else if (urlWrap) {
            urlWrap.classList.add('account-layby-pay-url-wrap--hidden');
        }
        if (pre && paymentResult.paymentInstructions) {
            pre.textContent = paymentResult.paymentInstructions;
            pre.classList.remove('account-layby-pay-instructions--hidden');
        } else if (pre) {
            pre.classList.add('account-layby-pay-instructions--hidden');
        }
    }

    async function pollVerify(transactionId, statusEl) {
        const start = Date.now();
        await sleep(POLL_FIRST_MS);
        while (Date.now() - start < POLL_TIMEOUT_MS) {
            let res;
            try {
                res = await fetch(`/api/payments/verify/${encodeURIComponent(transactionId)}`);
            } catch {
                await sleep(POLL_INTERVAL_MS);
                continue;
            }
            if (res.status === 429) {
                const retrySec = parseInt(res.headers.get('Retry-After') || '60', 10);
                if (statusEl) {
                    statusEl.textContent = `Too many checks; waiting ${retrySec}s…`;
                }
                await sleep(Math.min(retrySec * 1000, 120000));
                continue;
            }
            let data = {};
            try {
                data = await res.json();
            } catch {
                data = {};
            }
            if (data.success) {
                const status = data.status || data.lencoStatus;
                if (data.processing) {
                    if (statusEl) statusEl.textContent = 'Waiting for payment provider…';
                    await sleep(POLL_INTERVAL_MS);
                    continue;
                }
                if (status === 'completed') {
                    if (statusEl) statusEl.textContent = 'Payment received. Reloading…';
                    window.location.reload();
                    return;
                }
                if (status === 'failed' || status === 'cancelled') {
                    if (statusEl) {
                        statusEl.textContent = data.failureReason || 'Payment did not complete.';
                    }
                    return;
                }
                if (statusEl) statusEl.textContent = 'Still pending…';
            }
            await sleep(POLL_INTERVAL_MS);
        }
        if (statusEl) {
            statusEl.textContent =
                'Could not confirm payment in time. Refresh this page later or contact support if money left your wallet.';
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const customer = parseCustomer();
        document.querySelectorAll('.account-layby-pay-btn').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const block = btn.closest('.layby-plan-block');
                if (!block) return;
                const planId = block.getAttribute('data-plan-id');
                const statusEl = block.querySelector('.account-layby-pay-status');
                const providerEl = block.querySelector('.account-layby-provider');
                const phoneEl = block.querySelector('.account-layby-phone');
                if (!planId || !providerEl || !phoneEl) return;

                const provider = (providerEl.value || '').toLowerCase().trim();
                const customerPhone = phoneEl.value.trim();
                if (!provider || !['airtel', 'mtn'].includes(provider)) {
                    if (statusEl) statusEl.textContent = 'Choose Airtel or MTN.';
                    return;
                }
                if (!customerPhone) {
                    if (statusEl) statusEl.textContent = 'Enter the mobile money number to charge.';
                    return;
                }

                const csrf = getCsrf();
                if (!csrf) {
                    if (statusEl) statusEl.textContent = 'Security token missing. Refresh the page and try again.';
                    return;
                }

                resetFollowup(block);
                if (statusEl) statusEl.textContent = '';
                btn.disabled = true;
                const prevLabel = btn.textContent;
                btn.textContent = 'Starting…';

                try {
                    const startRes = await fetch(`/account/layby/${planId}/pay`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': csrf
                        },
                        body: JSON.stringify({})
                    });
                    const startData = await startRes.json().catch(() => ({}));
                    if (!startRes.ok || !startData.success) {
                        if (statusEl) {
                            statusEl.textContent = startData.message || 'Could not start installment payment.';
                        }
                        return;
                    }

                    const { laybyPaymentId, orderNumber } = startData;
                    if (!orderNumber) {
                        if (statusEl) statusEl.textContent = 'Order not found for this plan.';
                        return;
                    }

                    const paymentPayload = {
                        orderNumber,
                        paymentMethod: 'mobile_money',
                        laybyPaymentId,
                        customerInfo: {
                            name: customer.name || '',
                            email: customer.email || '',
                            phone: customerPhone
                        },
                        provider,
                        customerPhone
                    };

                    const payRes = await fetch('/api/payments/process', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': csrf
                        },
                        body: JSON.stringify(paymentPayload)
                    });
                    const payData = await payRes.json().catch(() => ({}));

                    if (payRes.status === 409) {
                        if (statusEl) {
                            statusEl.textContent =
                                payData.message ||
                                'A payment is already in progress for this installment. Wait or refresh.';
                        }
                        return;
                    }
                    if (!payRes.ok || !payData.success) {
                        if (statusEl) {
                            statusEl.textContent = payData.message || 'Payment could not be started.';
                        }
                        return;
                    }

                    showFollowup(block, payData);
                    if (statusEl) {
                        statusEl.textContent = 'Waiting for you to approve mobile money…';
                    }
                    const txId = payData.transactionId;
                    if (txId) {
                        pollVerify(txId, statusEl);
                    }
                } finally {
                    btn.disabled = false;
                    btn.textContent = prevLabel;
                }
            });
        });
    });
})();
