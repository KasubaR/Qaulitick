# Payment, order, and layby statuses

Reference for **Qualitick Collections**: where each status lives, what it means, and how they relate. Source of truth for ENUMs is the Sequelize models under `src/models/`.

---

## Quick map

| Layer | Field | Table / model |
|-------|--------|----------------|
| Gateway charge | `payments.status` | `Payment` |
| Order money state | `orders.paymentStatus` | `Order` |
| Order fulfilment | `orders.status` | `Order` |
| Layby contract | `layby_plans.status` | `LaybyPlan` |
| Layby line item | `layby_payments.status` | `LaybyPayment` |

---

## Payment (`payments.status`)

Defined in `src/models/Payment.model.js`.

| Status | Meaning |
|--------|---------|
| `pending` | Payment row created; collection not completed (includes Lenco `pay-offline` → pending). |
| `processing` | Gateway is actively collecting (customer in flow, USSD, bank, etc.). |
| `completed` | Collection succeeded. |
| `failed` | Collection failed. |
| `cancelled` | Collection cancelled or stopped; Lenco `expired` maps here via `mapLencoStatusToPaymentStatus`. |
| `refunded` | Refund recorded for this payment row. |

**Lenco → app mapping** lives in `Payment.mapLencoStatusToPaymentStatus` (`src/models/Payment.model.js`). Unknown Lenco strings default to `pending`.

**Terminal-ish states** (used for dedupe / polling in payment flow): `completed`, `failed`, `cancelled`, `refunded`.

---

## Order — payment vs fulfilment

### `orders.paymentStatus`

Defined in `src/models/Order.model.js`.

| Status | Meaning |
|--------|---------|
| `pending` | No successful payment recorded yet for this order. |
| `processing` | Payment in progress **or** (layby) balance still outstanding — order not fully paid. |
| `completed` | Fully paid (standard) or layby plan completed (`balanceRemaining` → 0). |
| `failed` | Payment failed (paired with order `payment_failed` when applicable). |
| `refunded` | Order-level refund state. |

**Runtime note:** `src/services/order.service.js` assigns `paymentStatus: 'cancelled'` when the gateway reports cancellation. The Sequelize ENUM in `Order.model.js` does **not** list `cancelled`; confirm your MySQL ENUM matches production usage or align model + migrations.

**Runtime note:** `src/services/scheduler.service.js` sets `paymentStatus: 'expired'` for stale unpaid **standard** orders. That value is **not** in the `Order` model ENUM — verify DB schema vs code.

### `orders.status` (fulfilment / lifecycle)

Defined in `src/models/Order.model.js`.

| Status | Typical meaning |
|--------|-----------------|
| `pending` | Order created; not yet in “waiting for payment” state. |
| `payment_pending` | Awaiting or processing payment (used when gateway says pending/processing). |
| `paid` | Payment completed; ready for ops (standard checkout). |
| `confirmed` | Confirmed by staff (if you use this step). |
| `processing` | Being prepared (do not confuse with `paymentStatus: processing`). |
| `packed` | Packed for dispatch. |
| `shipped` | In transit. |
| `delivered` | Delivered. |
| `cancelled` | Order cancelled. |
| `payment_failed` | Payment failed while order was still in early lifecycle. |
| `returned` | Return flow. |

**Naming caveat:** `orders.status` = `processing` (warehouse) is different from `orders.paymentStatus` = `processing` (money still moving or layby incomplete).

---

## Layby

### `layby_plans.status` (`LaybyPlan`)

Defined in `src/models/LaybyPlan.model.js`.

| Status | Meaning |
|--------|---------|
| `active` | Plan open; customer may pay installments. |
| `completed` | Full balance cleared; plan closed successfully. |
| `cancelled` | Plan ended without completion (admin, policy, or scheduler after expiry + balance). |

**Related field:** `nextDueAt` — next expected due checkpoint (updated in `src/services/layby.service.js`).

### `layby_payments.status` (`LaybyPayment`)

Defined in `src/models/LaybyPayment.model.js`.

| Status | Meaning |
|--------|---------|
| `pending` | Installment not yet satisfied. |
| `paid` | Installment satisfied (gateway or admin offline confirmation). |
| `overdue` | `dueAt` passed while still pending (`src/services/scheduler.service.js` flags these). |
| `waived` | Installment waived (if your process sets this; not all code paths may use it — confirm usage). |

**Sequence:** `sequence` 1 = deposit, 2+ = further installments.

---

## How they work together (short)

1. **Standard checkout:** `orders.paymentStatus` tracks money; `orders.status` moves from `pending` / `payment_pending` → `paid` → fulfilment states when payment completes (`order.service.js`, webhooks).

2. **Layby:** Order `paymentStatus` stays `processing` until the plan is fully paid; `orders.status` follows layby rules in `layby.service.js` (`payment_pending` until `paid`). `LaybyPlan` / `LaybyPayment` hold schedule and per-installment state.

3. **Payment rows:** Each Lenco collection (or retry) is a `payments` row; latest row is often surfaced to admins. Layby can link a `Payment` to `laybyPaymentId`.

4. **Layby display labels:** Customer/admin UI should not expose raw layby-related enum values directly. Display labels are derived in `src/utils/laybyStatusPresenter.js` so staff and customers see business wording such as `Deposit due`, `Balance outstanding`, `Overdue payment`, `Payment received`, and `Fully paid`.

---

## Layby display vocabulary

Persisted statuses remain compact enums, but the UI derives clearer labels:

| Persisted layer | Example raw value | Layby-facing label |
|-----------------|-------------------|--------------------|
| `orders.status` | `payment_pending` | `Layby awaiting payment` / `Balance outstanding` depending on plan progress |
| `orders.paymentStatus` | `processing` | `Layby balance outstanding` |
| `layby_plans.status` | `active` | `Active layby - balance outstanding` or `Active layby - overdue payment` |
| `layby_plans.status` | `completed` | `Fully paid` |
| `layby_payments.status` | `pending`, sequence 1 | `Deposit due` |
| `layby_payments.status` | `pending`, sequence 2+ | `Payment due` |
| `layby_payments.status` | `overdue` | `Overdue payment` |
| `payments.status` | `processing` | `Awaiting provider confirmation` |
| `payments.status` | `completed` | `Payment received` |

Customer and admin layby APIs/views can also surface derived fields such as `amountPaid`, `progressPercent`, `paymentArrangementLabel`, `nextActionLabel`, `nextDueLabel`, `isOverdue`, `hasPaymentInProgress`, and `nextPayableInstallmentId`.

### Layby payment attempts

- Customers may start online payment for `pending` **or** `overdue` layby installments while the plan is active.
- Flexible balance plans keep the balance row open for partial payments; each payment reduces the remaining balance until the plan is fully paid.
- Admin offline confirmations create `payments` audit rows, including partial flexible offline confirmations.
- Admin and scheduler cancellation should go through `laybyService.cancelLaybyPlan` so reserved stock is restored once and order history is written consistently.

---

## Suggested improvements

### 1. Align ENUMs with what the app actually writes

- **`orders.paymentStatus`:** Code can set `cancelled` (webhook path) and `expired` (scheduler). Either add these to the Sequelize ENUM + MySQL ENUM and document them here, or stop writing values that are not in the model (avoids silent truncation or DB errors).

### 2. Reduce naming collisions

- **`processing` on order vs payment:** Consider renaming one side in the long term (e.g. fulfilment `processing` → `preparing` or `warehouse_processing`) **or** documenting in UI copy only — changing DB ENUMs is a migration project.

### 3. Single source of truth for allowed values

- Centralise arrays like `ORDER_LIST_PAYMENT_STATUSES` (`order.controller.js`) and terminal payment states in one module (e.g. `src/constants/order-statuses.js`) imported by controllers, validators, and docs — reduces drift.

### 4. Layby vs order payment status

- Document (and optionally assert in tests) that layby **always** uses `orders.paymentStatus === 'processing'` until completion, so support and analytics do not misread “processing” as “card charging right now.”

### 5. `LaybyPayment.waived`

- If the product never sets `waived`, remove from ENUM or implement the admin path; if used, document when it is set.

### 6. Refund semantics

- Clarify when to use `payments.status = refunded` vs `orders.paymentStatus = refunded` (partial vs full order refund) in one short internal rule — avoids inconsistent dashboards.

### 7. Scheduler vs ENUM

- If `expired` remains on orders, add it to the model and run a migration so Sequelize and MySQL agree.

---

## File references

| Area | Files |
|------|--------|
| Models | `src/models/Order.model.js`, `Payment.model.js`, `LaybyPlan.model.js`, `LaybyPayment.model.js` |
| Order updates from gateway | `src/services/order.service.js` |
| Layby | `src/services/layby.service.js`, `src/config/layby.js` |
| Stale orders | `src/services/scheduler.service.js` |
| Lenco mapping | `mapLencoStatusToPaymentStatus` in `src/models/Payment.model.js` |

---

*Last updated from codebase review; after ENUM migrations, refresh the tables above.*
