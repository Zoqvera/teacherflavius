-- Selective production fix. Do not run a bulk migration replay.
-- Retain the original student_id match for active accounts.
-- For anonymized records, require both student IDs to be NULL and a
-- non-NULL, matching subject_ref, besides the existing exact tuition ID.
-- No ledger rows or payment amounts are changed by this DDL patch.
do $patch$
declare
  original_predicate constant text := $original$
    and tuition.student_id = attempt_row.student_id
$original$;
  corrected_predicate constant text := $corrected$
    and (
      tuition.student_id = attempt_row.student_id
      or (
        tuition.student_id is null
        and attempt_row.student_id is null
        and attempt_row.subject_ref is not null
        and tuition.subject_ref = attempt_row.subject_ref
      )
    )
$corrected$;
  current_definition text;
  occurrences integer;
begin
  select pg_get_functiondef(
    'public.process_mercado_pago_payment(uuid,text,text,text,numeric,text,boolean,timestamptz,timestamptz,timestamptz)'::regprocedure
  ) into current_definition;

  if current_definition is null then
    raise exception 'Payment settlement function missing; refusing to patch';
  end if;

  if position(corrected_predicate in current_definition) > 0
     and position(original_predicate in current_definition) = 0 then
    raise notice 'Anonymized payment reconciliation fix is already applied';
    return;
  end if;

  occurrences := (
    length(current_definition)
    - length(replace(current_definition, original_predicate, ''))
  ) / length(original_predicate);

  if occurrences <> 1 then
    raise exception 'Unexpected payment function definition (matches: %); refusing to patch', occurrences;
  end if;

  execute replace(current_definition, original_predicate, corrected_predicate);
end;
$patch$;

-- The existing function OID, SECURITY DEFINER setting, grants, and
-- payment idempotency logic remain unchanged.
