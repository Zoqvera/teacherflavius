-- Align the Wednesday 20h legacy group with the current five-student group model.
do $$
declare
  target_class_number integer;
begin
  select tc.class_number
    into target_class_number
  from public.teacher_classes tc
  where tc.is_active = true
    and tc.class_weekday = 3
    and tc.class_start_time = time '20:00'
  order by tc.class_number
  limit 1;

  if target_class_number is null then
    raise exception 'Turma ativa de quarta-feira 20h não encontrada.';
  end if;

  update public.teacher_classes
     set class_type = 'quintet',
         updated_at = now()
   where class_number = target_class_number;

  update public.profiles p
     set class_type = 'QUINTETO'
   where p.id in (
     select cs.user_id
     from public.class_students cs
     where cs.class_number = target_class_number
       and cs.user_id is not null
   );
end;
$$;
