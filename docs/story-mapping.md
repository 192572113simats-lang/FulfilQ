# Story S01–S13 Traceability Matrix

| Story | Summary | Implementation Files | Automated Tests |
| :--- | :--- | :--- | :--- |
| **S01** | Login & Server-Side RBAC | `apps/api/src/routes/auth.ts`, `apps/api/src/middleware/auth.ts`, `apps/web/src/pages/LoginPage.tsx` | `apps/api/src/tests/s01_auth_rbac.test.ts` |
| **S02** | Place Order & Atomic Reservation + Expiry | `apps/api/src/routes/orders.ts`, `apps/api/src/services/inventoryService.ts`, `apps/api/src/jobs/reservationExpiryJob.ts` | `apps/api/src/tests/s02_concurrency_expiry.test.ts` |
| **S03a** | Payment Idempotency Key & Local Stub | `apps/api/src/routes/payments.ts`, `apps/api/src/services/paymentGateway.ts` | `apps/api/src/tests/s03_payments_idempotency_outage.test.ts` |
| **S03b** | Sandbox Gateway & PAYMENT_PENDING Safe Retry | `apps/api/src/services/paymentGateway.ts`, `apps/api/src/routes/admin.ts`, `apps/web/src/pages/AdminPage.tsx` | `apps/api/src/tests/s03_payments_idempotency_outage.test.ts` |
| **S04** | Warehouse Pick List (Paid & Reserved Only) | `apps/api/src/routes/picking.ts`, `apps/web/src/pages/PickerPage.tsx` | `apps/api/src/tests/s01_auth_rbac.test.ts`, `apps/api/src/tests/s04_s12_picking_barcode.test.ts` |
| **S05** | Strict Order State Machine & Dispatch | `packages/shared/src/stateMachine.ts`, `apps/api/src/services/orderStateMachine.ts`, `apps/web/src/pages/DispatchPage.tsx` | `apps/api/src/tests/s05_s06_state_machine_tracking.test.ts` |
| **S06** | Accessible Customer Tracking Milestones | `packages/shared/src/stateMachine.ts`, `apps/api/src/routes/orders.ts`, `apps/web/src/pages/MyOrdersPage.tsx` | `apps/api/src/tests/s05_s06_state_machine_tracking.test.ts` |
| **S07** | Return Request (Owner & Regional Window) | `apps/api/src/routes/returns.ts`, `apps/web/src/pages/MyOrdersPage.tsx` | `apps/api/src/tests/s07_s08_returns_refund_limit.test.ts` |
| **S08** | Refund Approval (Role & Regional Limit + Audit) | `apps/api/src/routes/returns.ts`, `apps/api/src/services/auditService.ts`, `apps/web/src/pages/FinancePage.tsx` | `apps/api/src/tests/s07_s08_returns_refund_limit.test.ts` |
| **S09** | Build, Health/Ready, Docker & Restart Persistence | `apps/api/src/routes/health.ts`, `docker-compose.yml`, `apps/api/Dockerfile`, `apps/web/Dockerfile` | `apps/api/src/tests/s09_s10_s11_health_support_alerts_restart.test.ts` |
| **S10** | Support Lookup Console | `apps/api/src/routes/orders.ts`, `apps/web/src/pages/SupportPage.tsx` | `apps/api/src/tests/s09_s10_s11_health_support_alerts_restart.test.ts` |
| **S11** | Deterministic Fixed-Threshold Low-Stock Alert | `apps/api/src/services/inventoryService.ts`, `apps/api/src/routes/alerts.ts`, `apps/web/src/pages/DispatchPage.tsx` | `apps/api/src/tests/s09_s10_s11_health_support_alerts_restart.test.ts` |
| **S12** | Barcode Pick Confirmation & Text Fallback | `apps/api/src/routes/picking.ts`, `apps/web/src/pages/PickerPage.tsx` | `apps/api/src/tests/s04_s12_picking_barcode.test.ts` |
| **S13** | Sales Analytics & ML Forecasting (DEFERRED) | Intentionally deferred; Roadmap note only in `apps/web/src/pages/DeliveryBoardPage.tsx` | N/A (Deferred) |
