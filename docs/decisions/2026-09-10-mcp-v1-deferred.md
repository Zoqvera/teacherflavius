# TeacherFlavius MCP V1 experiment — deferred

Status: archived on 2026-09-10.

The former `agent/teacherflavius-mcp-v1` branch was an experimental read-only MCP server for academic data. Its original pull request (#65) was intentionally closed without merge. The prototype used a temporary bearer token for private development, had not completed dependency/typecheck validation in its original workflow, and explicitly required OAuth 2.1 plus request-level identity and authorization before any production ChatGPT integration.

The experiment is not part of the current production baseline. The historical pull request remains the reference for the prototype and its original implementation details.

If an MCP integration is revived, create a new branch from the then-current `main` and treat it as a new implementation. Minimum acceptance criteria:

- use current MCP SDK APIs and supported runtime versions;
- implement OAuth 2.1 or an equivalent production-grade identity and authorization model appropriate to the deployment;
- keep Supabase service-role credentials strictly server-side;
- enforce least-privilege data access and avoid exposing unnecessary personal or operational data;
- validate all database queries against the current schema and RLS/security model;
- add dependency installation, build, typecheck, tests, security review, and Clean Code validation to CI;
- merge only after all required checks pass.
