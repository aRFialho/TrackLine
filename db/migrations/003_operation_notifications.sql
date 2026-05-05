DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_action') THEN
    CREATE TYPE notification_action AS ENUM ('CONFIRM_OPERATION', 'UNCONFIRM_OPERATION');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.operation_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action notification_action NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.production_items(id) ON DELETE CASCADE,
  sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
  employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS operation_notifications_created_at_idx
  ON public.operation_notifications(created_at DESC);

CREATE INDEX IF NOT EXISTS operation_notifications_order_id_idx
  ON public.operation_notifications(order_id);

