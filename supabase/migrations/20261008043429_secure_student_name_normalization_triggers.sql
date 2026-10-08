-- Name-only trigger functions need a trusted owner context because the
-- private schema is intentionally inaccessible to authenticated API clients.
-- Their bodies never read or write any other rows.
alter function private.normalize_student_name_before_write() security definer;
alter function private.normalize_auth_student_name_before_write() security definer;