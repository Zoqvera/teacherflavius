-- Internal routines are reached only through privileged server code and triggers.
-- Browser roles have no USAGE on the private schema; revoke inherited EXECUTE
-- as a second boundary against accidental future schema exposure.
revoke execute on all functions in schema private from public, anon, authenticated;