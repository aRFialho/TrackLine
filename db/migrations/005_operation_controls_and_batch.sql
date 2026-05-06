ALTER TYPE notification_action ADD VALUE IF NOT EXISTS 'ROLLBACK_OPERATION';
ALTER TYPE notification_action ADD VALUE IF NOT EXISTS 'BATCH_OPERATION';

ALTER TABLE public.operation_notifications
  ADD COLUMN IF NOT EXISTS rollback_reason TEXT,
  ADD COLUMN IF NOT EXISTS batch_mode TEXT,
  ADD COLUMN IF NOT EXISTS requested_quantity NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS processed_quantity NUMERIC(12,2);

CREATE INDEX IF NOT EXISTS operation_notifications_action_created_idx
  ON public.operation_notifications(action, created_at DESC);
