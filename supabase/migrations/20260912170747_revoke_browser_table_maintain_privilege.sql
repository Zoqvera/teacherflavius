-- PostgreSQL 17 adds MAINTAIN as a table privilege. Browser roles do not need it.
revoke maintain on all tables in schema public from anon, authenticated;
