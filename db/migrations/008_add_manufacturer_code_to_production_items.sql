ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS manufacturer_code TEXT;
