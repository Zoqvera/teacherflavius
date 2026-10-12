-- Executar reconciliação sob privilégios restritos da função, não do usuário browser.
-- A tabela privada não pode ser acessada diretamente por alunos.
create or replace function private.reconcile_student_acquisition_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.enrolled is true and coalesce(new.archived,false)=false then
   perform private.inherit_student_acquisition(new.id);
 end if;
 return new;
end; $$;
revoke all on function private.reconcile_student_acquisition_trigger() from public, anon, authenticated;