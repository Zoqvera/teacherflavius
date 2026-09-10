# Pronunciation AI experiment — deferred

Status: archived on 2026-09-10.

The former `agent/pronunciation-ai` branch was an experimental implementation of AI-assisted pronunciation practice. Its original pull request (#64) was intentionally closed without merge because production activation still depended on Azure Speech credentials, at least one configured reading assignment, and an end-to-end validation of recording, assessment, storage, permissions, and student feedback.

The experiment is not part of the current production baseline. The historical pull request remains the reference for the prototype and its original implementation details.

If this capability is revived, create a new branch from the then-current `main` and treat the work as a new implementation. Minimum acceptance criteria:

- configure provider credentials only through server-side secrets;
- validate authentication, RLS, private audio storage, retention, and teacher access;
- test microphone recording and assessment end to end on supported browsers;
- align the UI with the current Teacher Flávio design/runtime system;
- add automated security, accessibility, responsive, performance, and Clean Code validation;
- merge only after all required checks pass.
