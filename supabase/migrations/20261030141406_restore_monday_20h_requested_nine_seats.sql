-- Preserve the previously requested nine-seat configuration for Monday 20h.
update public.teacher_classes
set capacity_override = 9
where class_number = 47
  and is_active = true
  and class_type = 'quintet'
  and capacity_override = 8;
