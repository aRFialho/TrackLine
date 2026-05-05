CREATE TABLE IF NOT EXISTS public.employee_sectors (
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  sector_id UUID NOT NULL REFERENCES public.sectors(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, sector_id)
);

CREATE INDEX IF NOT EXISTS employee_sectors_sector_id_idx
  ON public.employee_sectors(sector_id);

INSERT INTO public.employee_sectors (employee_id, sector_id)
SELECT e.id, e.sector_id
FROM public.employees e
ON CONFLICT (employee_id, sector_id) DO NOTHING;

