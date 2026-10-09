-- Preserve customized capacities when saving a class already typed EXPERIMENTAL.
do $patch$
declare old_def text; new_def text;
begin
  select pg_get_functiondef('public.set_teacher_class_type__mfa_inner(integer,text)'::regprocedure)
    into old_def;
  if position($old$when normalized_type in ('quintet','experimental') then 8$old$ in old_def)=0 then
    raise exception 'Expected experimental capacity branch not found.';
  end if;
  new_def:=replace(old_def,
    $old$when normalized_type in ('quintet','experimental') then 8$old$,
    $new$when normalized_type = 'quintet' then 8
           when normalized_type = 'experimental' then coalesce(capacity_override, 8)$new$);
  execute new_def;
end;
$patch$;