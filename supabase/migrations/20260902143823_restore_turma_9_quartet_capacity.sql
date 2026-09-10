create or replace function public.enforce_class_students_capacity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  occupied_count integer;
  capacity_limit integer;
  new_occupies_spot boolean := false;
begin
  if new.class_number is null then
    return new;
  end if;

  -- Turma 9 (class_number 48) usa novamente a capacidade padrão de quarteto: 4 alunos.
  -- A turma 73 mantém a exceção comercial já existente de até 5 alunos.
  capacity_limit := case when new.class_number = 73 then 5 else 4 end;

  perform pg_advisory_xact_lock(73008, new.class_number);

  if new.invite_id is not null then
    new_occupies_spot := true;
  elsif new.user_id is not null then
    select exists (
      select 1
      from public.profiles p
      where p.id = new.user_id
        and coalesce(p.enrolled, false) = true
        and coalesce(p.archived, false) = false
    ) into new_occupies_spot;
  end if;

  if not new_occupies_spot then
    return new;
  end if;

  select count(*)::integer
  into occupied_count
  from public.class_students cs
  left join public.profiles p on p.id = cs.user_id
  where cs.class_number = new.class_number
    and (tg_op <> 'UPDATE' or cs.id <> new.id)
    and (new.user_id is null or cs.user_id is distinct from new.user_id)
    and (new.invite_id is null or cs.invite_id is distinct from new.invite_id)
    and (
      cs.invite_id is not null
      or (
        cs.user_id is not null
        and coalesce(p.enrolled, false) = true
        and coalesce(p.archived, false) = false
      )
    );

  if occupied_count >= capacity_limit then
    raise exception 'Esta turma já atingiu o limite máximo de % alunos.', capacity_limit;
  end if;

  return new;
end;
$$;
