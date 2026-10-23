CREATE OR REPLACE FUNCTION private.get_class_operational_capacity(target_class_number integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN tc.class_type = 'quintet' AND tc.class_number = 52
      THEN COALESCE(tc.capacity_override::integer, 9)
    WHEN tc.class_type = 'quintet' AND tc.class_number = 47
      THEN 9
    WHEN tc.class_type = 'quintet'
      THEN COALESCE(tc.capacity_override::integer, 8)
    ELSE COALESCE(
      tc.capacity_override::integer,
      CASE WHEN tc.class_type = 'individual' THEN 1 ELSE NULL END
    )
  END
  FROM public.teacher_classes AS tc
  WHERE tc.class_number = target_class_number
  LIMIT 1;
$function$;