const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DRIFT_SCRIPT = path.join(ROOT, "scripts/check_supabase_migration_drift.sh");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function canonicalChecksum(content) {
  return crypto
    .createHash("sha256")
    .update(content.trim())
    .digest("hex");
}

function runDriftScript({
  migrationsDir,
  remoteRows = [],
  cutoff = "20261006000000",
  gitRoot = ROOT,
  baseRef = "",
  allowPrNew = false,
}) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "teacherflavius-migration-drift-"),
  );
  const binDir = path.join(tempRoot, "bin");

  fs.mkdirSync(binDir, { recursive: true });

  const psqlPath = path.join(binDir, "psql");
  const remoteOutput = remoteRows
    .map(({ version, name, checksum }) =>
      [version, name, checksum].join("\t"),
    )
    .join("\n");

  fs.writeFileSync(
    psqlPath,
    `#!/usr/bin/env bash
cat <<'REMOTE_ROWS'
${remoteOutput}
REMOTE_ROWS
`,
    { mode: 0o755 },
  );

  const result = spawnSync("bash", [DRIFT_SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_DB_URL: "postgresql://example.invalid/postgres",
      MIGRATIONS_DIR: migrationsDir,
      MIGRATION_GIT_ROOT: gitRoot,
      MIGRATION_DRIFT_CUTOFF: cutoff,
      MIGRATION_CHECKSUM_CUTOFF: "20261007051850",
      MIGRATION_BASE_REF: baseRef,
      MIGRATION_PR_ALLOW_NEW: allowPrNew ? "true" : "false",
      PATH: `${binDir}:${process.env.PATH}`,
    },
  });

  fs.rmSync(tempRoot, { recursive: true, force: true });

  return result;
}

function runDriftCheck({
  migrations,
  remoteRows = [],
  cutoff = "20261006000000",
  allowPrNew = false,
}) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "teacherflavius-migration-files-"),
  );

  try {
    for (const [filename, content] of Object.entries(migrations)) {
      fs.writeFileSync(path.join(tempRoot, filename), content);
    }

    return runDriftScript({
      migrationsDir: tempRoot,
      remoteRows,
      cutoff,
      allowPrNew,
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function createGitHistoryFixture({ filename, content }) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "teacherflavius-migration-git-"),
  );
  const migrationsDir = path.join(root, "supabase", "migrations");

  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(path.join(migrationsDir, filename), content);

  for (const args of [
    ["init", "-q"],
    ["config", "user.name", "Migration Test"],
    ["config", "user.email", "migration-test@example.com"],
    ["add", "supabase/migrations"],
    ["commit", "-qm", "baseline migrations"],
  ]) {
    const result = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  }

  const baseRefResult = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(baseRefResult.status, 0, baseRefResult.stderr);

  return {
    root,
    migrationsDir,
    baseRef: baseRefResult.stdout.trim(),
  };
}

const historicalStrictCancellation = read(
  "supabase/migrations/20261006013809_enforce_12h_lesson_cancellation.sql",
);
const canonicalCancellation = read(
  "supabase/migrations/20261006024346_unify_lesson_cancellation_policy.sql",
);
const driftScript = read("scripts/check_supabase_migration_drift.sh");
const driftWorkflow = read(".github/workflows/supabase-migration-drift.yml");
const baselineWorkflow = read(".github/workflows/validate-supabase-baseline.yml");
const tuitionBaseline = read(
  "supabase/baseline/130_enforce_tuition_after_enrollment.sql",
);

test("the production-only strict cancellation migration is preserved in Git", () => {
  assert.match(
    historicalStrictCancellation,
    /now\(\) > credit_row\.regular_starts_at - interval '12 hours'/i,
  );
  assert.match(
    historicalStrictCancellation,
    /O prazo para cancelamento terminou 12 horas antes da aula/i,
  );
});

test("the later canonical migration supersedes the strict 12-hour rule", () => {
  assert.match(
    canonicalCancellation,
    /create or replace function private\.lesson_can_be_cancelled/i,
  );
  assert.match(
    canonicalCancellation,
    /evaluated_at < target_starts_at/i,
  );
  assert.match(
    canonicalCancellation,
    /evaluated_at <= target_starts_at - interval '12 hours'/i,
  );
  assert.doesNotMatch(
    canonicalCancellation,
    /O prazo para cancelamento terminou 12 horas antes da aula/i,
  );
});

test("CI compares version, name, and checksum instead of versions alone", () => {
  assert.match(driftScript, /supabase_migrations\.schema_migrations/i);
  assert.match(driftScript, /extensions\.digest/i);
  assert.match(driftScript, /sha256sum/);
  assert.match(driftScript, /validate_unique_local_versions/);
  assert.match(driftScript, /validate_historical_immutability/);
  assert.doesNotMatch(driftScript, /\|\s*sort -u/);
  assert.match(driftWorkflow, /SUPABASE_DB_URL/);
  assert.match(driftWorkflow, /MIGRATION_BASE_REF/);
  assert.match(driftWorkflow, /MIGRATION_CHECKSUM_CUTOFF/);
  assert.match(driftWorkflow, /fetch-depth:\s*0/);
  assert.match(
    driftWorkflow,
    /bash scripts\/check_supabase_migration_drift\.sh/,
  );
});

test("duplicate migration IDs fail even before the cutoff when contents differ", () => {
  const result = runDriftCheck({
    migrations: {
      "20250101000000_first.sql": "select 1;\n",
      "20250101000000_second.sql": "select 2;\n",
    },
  });

  assert.equal(result.status, 1);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Duplicate Supabase migration versions.*20250101000000/is,
  );
});

test("duplicate migration IDs fail even when contents are identical", () => {
  const result = runDriftCheck({
    migrations: {
      "20250101000000_first.sql": "select 1;\n",
      "20250101000000_second.sql": "select 1;\n",
    },
  });

  assert.equal(result.status, 1);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Duplicate Supabase migration versions.*20250101000000/is,
  );
});

test("a previously committed migration cannot change content", () => {
  const fixture = createGitHistoryFixture({
    filename: "20250101000000_locked.sql",
    content: "select 1;\n",
  });

  try {
    fs.writeFileSync(
      path.join(fixture.migrationsDir, "20250101000000_locked.sql"),
      "select 2;\n",
    );

    const result = runDriftScript({
      migrationsDir: fixture.migrationsDir,
      gitRoot: fixture.root,
      baseRef: fixture.baseRef,
    });

    assert.equal(result.status, 1);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Previously committed migrations are immutable.*checksum changed/is,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a previously committed migration cannot be renamed", () => {
  const fixture = createGitHistoryFixture({
    filename: "20250101000001_locked_name.sql",
    content: "select 1;\n",
  });

  try {
    fs.renameSync(
      path.join(fixture.migrationsDir, "20250101000001_locked_name.sql"),
      path.join(fixture.migrationsDir, "20250101000001_changed_name.sql"),
    );

    const result = runDriftScript({
      migrationsDir: fixture.migrationsDir,
      gitRoot: fixture.root,
      baseRef: fixture.baseRef,
    });

    assert.equal(result.status, 1);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Previously committed migrations are immutable.*base name:.*current name:/is,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("production checksum drift fails after the cutoff", () => {
  const result = runDriftCheck({
    migrations: {
      "20261007060001_example.sql": "select 1;\n",
    },
    remoteRows: [
      {
        version: "20261007060001",
        name: "example",
        checksum: "0".repeat(64),
      },
    ],
  });

  assert.equal(result.status, 1);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Migration identity differs between production and Git.*sha256/is,
  );
});

test("production name drift fails after the cutoff", () => {
  const sql = "select 1;\n";
  const result = runDriftCheck({
    migrations: {
      "20261006000002_expected_name.sql": sql,
    },
    remoteRows: [
      {
        version: "20261006000002",
        name: "different_name",
        checksum: canonicalChecksum(sql),
      },
    ],
  });

  assert.equal(result.status, 1);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Migration identity differs between production and Git.*production name.*Git name/is,
  );
});

test("a unique migration with matching production identity passes", () => {
  const sql = "\nselect 1;\n\n";
  const result = runDriftCheck({
    migrations: {
      "20261007060003_example.sql": sql,
    },
    remoteRows: [
      {
        version: "20261007060003",
        name: "example",
        checksum: canonicalChecksum(sql),
      },
    ],
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /migration IDs are globally unique/i);
});

test("baseline reconstruction applies the canonical cancellation policy", () => {
  assert.match(
    baselineWorkflow,
    /supabase\/baseline\/230_unify_lesson_cancellation_policy\.sql/,
  );
});

test("baseline reconstructs tuition exemption fields required by later overlays", () => {
  assert.match(
    tuitionBaseline,
    /add column if not exists is_exempt boolean not null default false/i,
  );
  assert.match(
    tuitionBaseline,
    /add column if not exists exempted_at timestamptz/i,
  );
  assert.match(
    tuitionBaseline,
    /add column if not exists exemption_notes text/i,
  );
});

test("PR can propose only new migration versions above the production tip", () => {
  const committed = "select 1;\n";
  const proposal = "select 2;\n";
  const result = runDriftCheck({
    migrations: {
      "20261007060003_existing.sql": committed,
      "20261014162600_proposed.sql": proposal,
    },
    remoteRows: [{
      version: "20261007060003",
      name: "existing",
      checksum: canonicalChecksum(committed),
    }],
    allowPrNew: true,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Proposed, unapplied PR migration 20261014162600/);
});

test("the same unapplied migration is rejected outside PR mode", () => {
  const sql = "select 1;\n";
  const result = runDriftCheck({
    migrations: { "20261014162600_proposed.sql": sql },
    remoteRows: [{
      version: "20261007060003",
      name: "existing",
      checksum: canonicalChecksum(sql),
    }],
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing from production migration history/);
});

test("PR mode rejects a new migration placed before a deployed version", () => {
  const sql = "select 1;\n";
  const result = runDriftCheck({
    migrations: {
      "20261007060003_existing.sql": sql,
      "20261007060001_backdated.sql": "select 2;\n",
    },
    remoteRows: [{
      version: "20261007060003",
      name: "existing",
      checksum: canonicalChecksum(sql),
    }],
    allowPrNew: true,
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /must be newer than the current production tip/);
});

test("PR mode still rejects modification of deployed migration SQL", () => {
  const sql = "select 1;\n";
  const result = runDriftCheck({
    migrations: { "20261007060003_existing.sql": "select 2;\n" },
    remoteRows: [{
      version: "20261007060003",
      name: "existing",
      checksum: canonicalChecksum(sql),
    }],
    allowPrNew: true,
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Migration identity differs between production and Git/);
});

test("CI enables append-only proposal mode exclusively for pull requests", () => {
  assert.match(driftWorkflow, /MIGRATION_PR_ALLOW_NEW:.*github.event_name == 'pull_request'/);
  assert.match(driftScript, /new_version.*production_tip/);
  assert.match(driftScript, /MIGRATION_PR_ALLOW_NEW/);
});


test("the singular Supabase-generated version alias passes only for identical pinned SQL", () => {
  const filename = "20261015030100_add_regular_and_teacher_cancellation_email_notifications.sql";
  const content = read("supabase/migrations/" + filename);
  const expectedChecksum = "5dc7e85b53bc3ebad9b96a759e78f9ce681939f8bd0edb8e8baaa34a6978839e";
  assert.equal(canonicalChecksum(content), expectedChecksum);

  const accepted = runDriftCheck({
    migrations: { [filename]: content },
    remoteRows: [{
      version: "20261015030846",
      name: "add_regular_and_teacher_cancellation_email_notifications",
      checksum: expectedChecksum,
    }],
  });
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.match(accepted.stdout, /Exact SHA256 and name attest Supabase-generated migration alias/);

  const tampered = runDriftCheck({
    migrations: { [filename]: content + "\nselect 999;\n" },
    remoteRows: [{
      version: "20261015030846",
      name: "add_regular_and_teacher_cancellation_email_notifications",
      checksum: expectedChecksum,
    }],
  });
  assert.equal(tampered.status, 1);
  assert.match(tampered.stdout, /missing from supabase\/migrations|missing from production migration history/);
});

test("the attested alias rejects mismatched names, remote hashes and unrelated remote versions", () => {
  const filename = "20261015030100_add_regular_and_teacher_cancellation_email_notifications.sql";
  const content = read("supabase/migrations/" + filename);
  const original = {
    version: "20261015030846",
    name: "add_regular_and_teacher_cancellation_email_notifications",
    checksum: canonicalChecksum(content),
  };
  for (const changed of [
    { ...original, name: "a_different_migration" },
    { ...original, checksum: "0".repeat(64) },
    { ...original, version: "20261015030847" },
  ]) {
    const result = runDriftCheck({
      migrations: { [filename]: content },
      remoteRows: [changed],
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Production contains migration versions.*missing|supabase\/migrations contains versions.*missing/is);
  }
});
