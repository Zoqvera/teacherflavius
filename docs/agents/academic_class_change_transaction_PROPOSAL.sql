-- PROPOSTA PARA HOMOLOGAÇÃO. NÃO É MIGRAÇÃO ATIVA.
-- Etapa 8: uma única transação por vínculo ou transferência.
-- Antes de implantar: executar testes de autorização, concorrência e créditos
-- em banco isolado. Não executar esta proposta diretamente em produção.

create table if not exists private.academic_agent_action_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  student_id uuid not null,
  action text not null check (action in ('new_link','transfer')),
  old_class_numbers integer[] not null,
  from_class_number integer,
  to_class_number integer not null,
  first_lesson_date date,
  declared_acquisition_source text,
  created_at timestamptz not null default now()
);

alter table private.academic_agent_action_audit enable row level security;
revoke all on private.academic_agent_action_audit from public, anon, authenticated;

create or replace function public.execute_teacher_academic_change(
  target_action text,
  target_student_id uuid,
  target_class_number integer,
  expected_class_numbers integer[],
  target_from_class_number integer default null,
  target_first_lesson_date date default null,
  target_source text default null,
  target_source_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  student public.profiles%rowtype;
  destination public.teacher_classes%rowtype;
  previous_classes integer[];
  expected_sorted integer[];
  linked_id uuid;
  actual_first_lesson date;
  available_count integer;
  unresolved_credits integer;
begin
  if auth.uid() is null or not coalesce(public.is_teacher_admin(), false) then
    raise exception 'Acesso exclusivo do professor.' using errcode = '42501';
  end if;

  if target_action not in ('new_link','transfer')
     or target_student_id is null or target_class_number is null
     or expected_class_numbers is null then
    raise exception 'Solicitação acadêmica incompleta.' using errcode = '22023';
  end if;

  select * into student from public.profiles p
  where p.id = target_student_id for update;

  if not found or student.enrolled is not true or student.archived is true
     or exists (select 1 from public.teacher_admins a where a.user_id=target_student_id) then
    raise exception 'Aluno ativo não encontrado.' using errcode = '23514';
  end if;

  -- Lock memberships, then compare against the exact preview.
  perform 1 from public.class_students cs
  where cs.user_id = target_student_id for update;
  select coalesce(array_agg(cs.class_number order by cs.class_number), '{}'::integer[])
  into previous_classes from public.class_students cs
  where cs.user_id = target_student_id;

  select coalesce(array_agg(number order by number), '{}'::integer[])
  into expected_sorted from unnest(expected_class_numbers) as number;
  if cardinality(expected_sorted) > 2
     or cardinality(expected_sorted) <>
       (select count(distinct number) from unnest(expected_sorted) as number)
     or previous_classes is distinct from expected_sorted then
    raise exception 'Os vínculos mudaram desde a prévia. Consulte novamente.' using errcode='23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(73008, target_class_number);
  select * into destination from public.teacher_classes c
  where c.class_number=target_class_number
    and c.is_active=true and c.class_type='quintet'
  for update;

  if not found or destination.class_weekday is null or destination.class_start_time is null then
    raise exception 'Turma de grupo inexistente ou sem horário válido.' using errcode='23514';
  end if;

  if target_class_number = any(previous_classes) then
    raise exception 'Aluno já pertence à turma de destino.' using errcode='23505';
  end if;

  -- DB triggers independently recheck seat capacity, invitations and live holds.
  available_count := private.get_class_operational_capacity(target_class_number)
    - private.count_class_seat_members(target_class_number)
    - private.count_class_seat_holds(target_class_number);
  if available_count is null or available_count <= 0 then
    raise exception 'Não há vaga segura na turma de destino.' using errcode='23514';
  end if;

  if target_action = 'new_link' then
    if cardinality(previous_classes) >= 2 then
      raise exception 'Aluno já tem dois vínculos. Utilize transferência.' using errcode='23514';
    end if;
    if target_from_class_number is not null or target_first_lesson_date is null
       or nullif(btrim(target_source),'') is null then
      raise exception 'Novo vínculo exige origem e primeira aula, sem turma de saída.' using errcode='22023';
    end if;
    if extract(isodow from target_first_lesson_date)::integer <> destination.class_weekday
       or (destination.first_lesson_date is not null and
           target_first_lesson_date < destination.first_lesson_date) then
      raise exception 'Primeira aula incompatível com o calendário da turma.' using errcode='23514';
    end if;
    perform private.validate_acquisition_origin(target_source,target_source_detail);

    insert into public.class_students (class_number,user_id,first_lesson_date)
    values (target_class_number,target_student_id,target_first_lesson_date)
    returning id,first_lesson_date into linked_id,actual_first_lesson;

    -- The first-lesson trigger may reject a past/too-early requested date.
    -- Do not silently move an agreed date or leave credits mapped inconsistently.
    if actual_first_lesson is distinct from target_first_lesson_date then
      raise exception 'A primeira aula informada antecede a próxima aula elegível.' using errcode='23514';
    end if;

    perform private.save_student_acquisition(
      target_student_id,target_source,target_source_detail,'teacher',null
    );

  else
    if target_from_class_number is null
       or target_first_lesson_date is not null
       or target_source is not null or target_source_detail is not null
       or target_from_class_number = target_class_number
       or not (target_from_class_number = any(previous_classes)) then
      raise exception 'Transferência inválida. Informe somente a turma de origem.' using errcode='22023';
    end if;

    -- DELETE then INSERT in the SAME Postgres transaction.
    -- The canonical class_students triggers realign only unmodified,
    -- paid future contractual credits orphaned by the old-class removal.
    delete from public.class_students
    where user_id=target_student_id and class_number=target_from_class_number;
    if not found then
      raise exception 'Vínculo de origem não encontrado.' using errcode='23514';
    end if;

    insert into public.class_students (class_number,user_id)
    values (target_class_number,target_student_id)
    returning id,first_lesson_date into linked_id,actual_first_lesson;

    select count(*)::integer into unresolved_credits
    from private.lesson_credits credit
    join public.monthly_tuition tuition on tuition.id=credit.tuition_id
      and (tuition.payment_date is not null or tuition.is_exempt=true)
    where credit.student_id=target_student_id
      and credit.credit_origin='contract'
      and credit.status='scheduled'
      and credit.revoked_at is null
      and credit.cancelled_at is null
      and credit.makeup_booking_id is null
      and credit.regular_starts_at>now()
      and not exists (
        select 1 from public.class_students current_link
        where current_link.user_id=target_student_id
          and current_link.class_number=credit.regular_class_number
      );
    if unresolved_credits <> 0 then
      raise exception 'Créditos futuros não remapeados. A transferência foi desfeita.' using errcode='23514';
    end if;
  end if;

  insert into private.academic_agent_action_audit (
    actor_id,student_id,action,old_class_numbers,from_class_number,to_class_number,
    first_lesson_date,declared_acquisition_source
  ) values (
    auth.uid(),target_student_id,target_action,previous_classes,target_from_class_number,
    target_class_number,actual_first_lesson,
    case when target_action='new_link' then target_source else null end
  );

  return jsonb_build_object(
    'ok',true,'action',target_action,'student_id',target_student_id,
    'to_class_number',target_class_number,'from_class_number',target_from_class_number,
    'first_lesson_date',actual_first_lesson
  );
end;
$function$;

revoke all on function public.execute_teacher_academic_change(
  text,uuid,integer,integer[],integer,date,text,text
) from public, anon, authenticated;
grant execute on function public.execute_teacher_academic_change(
  text,uuid,integer,integer[],integer,date,text,text
) to authenticated;
