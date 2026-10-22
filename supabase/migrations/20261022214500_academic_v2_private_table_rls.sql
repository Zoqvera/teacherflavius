-- Hardening adicional da etapa 4. Historico de migracoes preservado.
-- Somente defesa em profundidade no esquema private; automacao permanece desativada.

alter table private.academic_v2_automation_control
  enable row level security;
alter table private.academic_v2_closed_session_snapshots
  enable row level security;
alter table private.academic_v2_attendance_audit
  enable row level security;

-- O agendador e as rotinas sao executados pelo proprietario/roles privilegiadas.
-- Nenhuma nova permissao e concedida a anon ou authenticated.
