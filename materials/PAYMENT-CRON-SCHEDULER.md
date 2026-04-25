# Payment Cron Scheduler Implementation

This project implements payment cron scheduling using Laravel's scheduler in `routes/console.php`, with the actual polling logic in `app/Console/Commands/PollPendingPayments.php`.

## Where the scheduler is defined

In `routes/console.php`, the payment task is registered as:

- Command: `payments:poll-pending`
- Frequency: every 5 minutes (`->everyFiveMinutes()`)
- Concurrency guard: `->withoutOverlapping()`
- Execution mode: `->runInBackground()`

So the framework-level scheduler triggers this command periodically, and Laravel prevents overlapping runs of the same task.

## What the cron command does

`PollPendingPayments` polls Lenco for payments that are still in-flight and may have missed webhook updates.

It selects payments that:

- have `status` in `pending` or `processing`
- have a `lenco_transaction_id`
- are at least 2 minutes old (to give webhook delivery time first)
- are not too far beyond expiry (keeps a grace window)

For each payment:

- Calls `LencoService::verifyPayment(...)`
- Maps Lenco status via `LencoService::mapStatus(...)`
- Persists latest provider status with `Payment::updateLencoStatus(...)`
- Handles terminal outcomes:
  - `completed`: stamps `completed_at` and runs `PaymentCompletionService::complete(...)`
  - `failed`: stamps `failed_at`, stores reason, updates registration status
  - `cancelled` / expired: marks cancelled and updates registration status

## Idempotency and safety

The flow is designed to be safe even when multiple status paths exist (webhook, frontend verify polling, scheduled poller):

- Scheduler overlap lock: `withoutOverlapping()`
- Completion dedupe: `PaymentCompletionService` uses `notified_at` + row lock (`lockForUpdate()`)
- Poller updates are robust to re-runs (status transitions are guarded before completion side-effects)

This prevents duplicate completion side-effects (email/slot update) if webhook and scheduler race.

## How it fits with other payment mechanisms

Payment status can be updated through three channels:

1. **Webhook**: `PaymentController@webhook` (authoritative event push from Lenco)
2. **Frontend verify endpoints**: `verify(...)` and `verifyByReference(...)` (user-driven polling)
3. **Scheduler fallback**: `payments:poll-pending` (catches missed webhooks)

The scheduled poller is the resilience path: it ensures pending payments do not remain stuck forever when webhook delivery fails.

## Related retry job (separate from cron scheduler)

`app/Jobs/RetryLencoPayment.php` is queue-based retry logic for initiation failures (network/5xx), not the scheduler itself. It retries Lenco initiation with backoff and marks terminal failures when retries are exhausted.

## Operational requirement

To make this work in production, Laravel's scheduler runner must be active (for example, a system cron invoking `php artisan schedule:run` every minute, or `php artisan schedule:work` under a process supervisor).

