CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM ('ABERTA', 'FINALIZADA');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operation_status') THEN
    CREATE TYPE operation_status AS ENUM ('PENDENTE', 'CONCLUIDA');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.work_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_start TIME NOT NULL,
  work_end TIME NOT NULL,
  lunch_start TIME NOT NULL,
  lunch_end TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employees_sector_id_idx ON public.employees(sector_id);
CREATE INDEX IF NOT EXISTS employees_name_idx ON public.employees(name);

CREATE TABLE IF NOT EXISTS public.production_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status order_status NOT NULL DEFAULT 'ABERTA',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS production_orders_status_idx ON public.production_orders(status);
CREATE INDEX IF NOT EXISTS production_orders_created_at_idx ON public.production_orders(created_at DESC);

CREATE TABLE IF NOT EXISTS public.production_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.production_orders(id) ON DELETE CASCADE,
  quantity NUMERIC(12,2) NOT NULL,
  unit TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS production_items_order_id_idx ON public.production_items(order_id);
CREATE INDEX IF NOT EXISTS production_items_description_idx ON public.production_items(description);

CREATE TABLE IF NOT EXISTS public.item_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.production_items(id) ON DELETE CASCADE,
  sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
  employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  status operation_status NOT NULL DEFAULT 'PENDENTE',
  released_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  useful_minutes INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS item_operations_item_id_idx ON public.item_operations(item_id);
CREATE INDEX IF NOT EXISTS item_operations_sector_id_idx ON public.item_operations(sector_id);
CREATE INDEX IF NOT EXISTS item_operations_employee_id_idx ON public.item_operations(employee_id);
CREATE INDEX IF NOT EXISTS item_operations_status_idx ON public.item_operations(status);

INSERT INTO public.work_schedules (work_start, work_end, lunch_start, lunch_end)
SELECT '08:00', '18:00', '12:00', '13:00'
WHERE NOT EXISTS (SELECT 1 FROM public.work_schedules);

INSERT INTO public.sectors (name, position)
SELECT 'Corte', 1
WHERE NOT EXISTS (SELECT 1 FROM public.sectors WHERE name = 'Corte');

INSERT INTO public.sectors (name, position)
SELECT 'Costura', 2
WHERE NOT EXISTS (SELECT 1 FROM public.sectors WHERE name = 'Costura');

INSERT INTO public.sectors (name, position)
SELECT 'Tapecaria', 3
WHERE NOT EXISTS (SELECT 1 FROM public.sectors WHERE name = 'Tapecaria');

