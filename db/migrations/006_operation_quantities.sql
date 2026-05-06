ALTER TABLE public.item_operations
  ADD COLUMN IF NOT EXISTS released_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_quantity NUMERIC(12,2) NOT NULL DEFAULT 0;

WITH first_sector AS (
  SELECT io.item_id, MIN(s.position) AS min_position
  FROM public.item_operations io
  JOIN public.sectors s ON s.id = io.sector_id
  GROUP BY io.item_id
)
UPDATE public.item_operations io
SET released_quantity = CASE
      WHEN io.status = 'CONCLUIDA'::operation_status THEN pi.quantity
      WHEN s.position = fs.min_position THEN pi.quantity
      ELSE 0
    END,
    completed_quantity = CASE
      WHEN io.status = 'CONCLUIDA'::operation_status THEN pi.quantity
      ELSE 0
    END
FROM public.production_items pi,
     public.sectors s,
     first_sector fs
WHERE pi.id = io.item_id
  AND s.id = io.sector_id
  AND fs.item_id = io.item_id
  AND (io.released_quantity = 0 OR io.completed_quantity = 0);
