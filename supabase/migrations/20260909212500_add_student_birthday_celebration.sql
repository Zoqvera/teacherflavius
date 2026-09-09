create table if not exists public.student_birthday_celebrations (
  student_id uuid not null references public.profiles(id) on delete cascade,
  birthday_year integer not null,
  claimed_at timestamptz not null default now(),
  primary key (student_id, birthday_year),
  constraint student_birthday_celebrations_year_check
    check (birthday_year between 2000 and 9999)
);

alter table public.student_birthday_celebrations enable row level security;

revoke all on table public.student_birthday_celebrations from public, anon, authenticated;

create or replace function public.claim_my_birthday_celebration()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile_row public.profiles%rowtype;
  today_sp date;
  current_year integer;
  birth_month integer;
  birth_day integer;
  last_day_of_birth_month integer;
  birthday_date date;
  celebration_window_end date;
  inserted_count integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('show', false);
  end if;

  select p.*
  into profile_row
  from public.profiles p
  where p.id = auth.uid();

  if profile_row.id is null
     or coalesce(profile_row.enrolled, false) = false
     or coalesce(profile_row.archived, false) = true
     or profile_row.date_of_birth is null then
    return jsonb_build_object('show', false);
  end if;

  today_sp := timezone('America/Sao_Paulo', now())::date;
  current_year := extract(year from today_sp)::integer;
  birth_month := extract(month from profile_row.date_of_birth)::integer;
  birth_day := extract(day from profile_row.date_of_birth)::integer;

  last_day_of_birth_month := extract(
    day from (
      date_trunc('month', make_date(current_year, birth_month, 1))
      + interval '1 month - 1 day'
    )::date
  )::integer;

  birthday_date := make_date(
    current_year,
    birth_month,
    least(birth_day, last_day_of_birth_month)
  );
  celebration_window_end := birthday_date + 5;

  if today_sp < birthday_date or today_sp > celebration_window_end then
    return jsonb_build_object(
      'show', false,
      'birthday_date', birthday_date,
      'window_end', celebration_window_end
    );
  end if;

  insert into public.student_birthday_celebrations (
    student_id,
    birthday_year,
    claimed_at
  )
  values (
    auth.uid(),
    current_year,
    now()
  )
  on conflict (student_id, birthday_year) do nothing;

  get diagnostics inserted_count = row_count;

  return jsonb_build_object(
    'show', inserted_count = 1,
    'birthday_date', birthday_date,
    'window_end', celebration_window_end
  );
end;
$$;

revoke execute on function public.claim_my_birthday_celebration() from public, anon;
grant execute on function public.claim_my_birthday_celebration() to authenticated;

comment on table public.student_birthday_celebrations is
  'Registro anual e idempotente da primeira exibição da celebração de aniversário do aluno.';

comment on function public.claim_my_birthday_celebration() is
  'Reserva atomicamente a celebração anual do aluno no primeiro acesso entre o aniversário e cinco dias depois, usando o fuso America/Sao_Paulo.';
