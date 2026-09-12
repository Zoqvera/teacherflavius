const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8").toLowerCase();
}

const browserPrivilegeMigration = read(
  "supabase/migrations/20260912170403_reduce_existing_browser_role_privileges.sql"
);
const maintainMigration = read(
  "supabase/migrations/20260912170747_revoke_browser_table_maintain_privilege.sql"
);
const restorePrivileges = read("supabase/baseline/20_default_privileges.sql");

test("browser roles cannot retain destructive table privileges", function () {
  assert.match(
    browserPrivilegeMigration,
    /revoke\s+truncate,\s*references,\s*trigger\s+on\s+all\s+tables\s+in\s+schema\s+public\s+from\s+anon,\s*authenticated/
  );
  assert.match(
    maintainMigration,
    /revoke\s+maintain\s+on\s+all\s+tables\s+in\s+schema\s+public\s+from\s+anon,\s*authenticated/
  );
});

test("anonymous direct table access is limited to the public content override", function () {
  assert.match(
    browserPrivilegeMigration,
    /revoke\s+all\s+on\s+all\s+tables\s+in\s+schema\s+public\s+from\s+anon/
  );
  assert.match(
    browserPrivilegeMigration,
    /grant\s+select\s+on\s+table\s+public\.page_content_overrides\s+to\s+anon/
  );
});

test("authenticated grants are reduced when no matching RLS operation exists", function () {
  assert.match(
    browserPrivilegeMigration,
    /revoke\s+delete,\s*insert,\s*update\s+on\s+table\s+public\.class_students\s+from\s+authenticated/
  );
  assert.match(
    browserPrivilegeMigration,
    /revoke\s+delete\s+on\s+table\s+public\.student_private_data\s+from\s+authenticated/
  );
  assert.match(
    browserPrivilegeMigration,
    /revoke\s+update\s+on\s+table\s+public\.student_tags\s+from\s+authenticated/
  );
});

test("restore baseline defaults deny browser access until explicitly granted", function () {
  assert.match(
    restorePrivileges,
    /alter\s+default\s+privileges\s+for\s+role\s+postgres\s+in\s+schema\s+public\s+revoke\s+all\s+on\s+tables\s+from\s+public,\s*anon,\s*authenticated/
  );
  assert.match(
    restorePrivileges,
    /revoke\s+all\s+on\s+all\s+tables\s+in\s+schema\s+public\s+from\s+anon,\s*authenticated/
  );
  assert.doesNotMatch(
    restorePrivileges,
    /grant\s+all\s+on\s+tables\s+to\s+anon/
  );
  assert.doesNotMatch(
    restorePrivileges,
    /grant\s+all\s+on\s+tables\s+to\s+authenticated/
  );
});

test("restore baseline keeps browser grants explicit and conditional", function () {
  assert.match(restorePrivileges, /\('profiles',\s*'select, insert, update'\)/);
  assert.match(restorePrivileges, /\('student_frequency',\s*'select'\)/);
  assert.match(restorePrivileges, /\('student_private_data',\s*'select, insert, update'\)/);
  assert.match(restorePrivileges, /to_regclass\(format\('public\.%i'/);
});
