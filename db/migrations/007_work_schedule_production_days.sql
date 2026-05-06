ALTER TABLE public.work_schedules
  ADD COLUMN IF NOT EXISTS production_days TEXT[] NOT NULL DEFAULT ARRAY['MON','TUE','WED','THU','FRI'];

UPDATE public.work_schedules
SET production_days = ARRAY['MON','TUE','WED','THU','FRI']
WHERE production_days IS NULL OR array_length(production_days, 1) IS NULL;
