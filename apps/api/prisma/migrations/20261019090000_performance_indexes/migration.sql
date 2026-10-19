-- Indexes for the query patterns added in phases 5-8. Plain CREATE INDEX locks writes
-- on the table while it builds; on a large production table, run these by hand with
-- CREATE INDEX CONCURRENTLY first (same names), then mark this migration applied.

-- CreateIndex
CREATE INDEX "orders_companyId_deliveredAt_idx" ON "orders"("companyId", "deliveredAt");

-- CreateIndex
CREATE INDEX "conversations_companyId_createdAt_idx" ON "conversations"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "conversations_companyId_handoverAt_idx" ON "conversations"("companyId", "handoverAt");

-- CreateIndex
CREATE INDEX "messages_direction_deliveryStatus_createdAt_idx" ON "messages"("direction", "deliveryStatus", "createdAt");

-- CreateIndex
CREATE INDEX "subscriptions_status_currentPeriodEnd_idx" ON "subscriptions"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "invoices_subscriptionId_status_idx" ON "invoices"("subscriptionId", "status");
