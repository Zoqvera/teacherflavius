const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function loadSessionService() {
  const redirects = [];
  const context = {
    window: {
      location: {
        replace(url) {
          redirects.push(url);
        }
      }
    }
  };
  vm.runInNewContext(read("auth_session_service.js"), context);
  return { module: context.window.AuthSessionService, redirects };
}

function dependencies(client) {
  return {
    getClient() { return client; },
    requireClient() { return client; },
    getGoogleRedirectUrl() { return "https://example.test/google"; },
    getGoogleLinkRedirectUrl() { return "https://example.test/link"; },
    getPasswordRecoveryRedirectUrl() { return "https://example.test/reset"; },
    loginPath: "/login/"
  };
}

test("local and global sign-out use explicit Supabase scopes", async function () {
  const scopes = [];
  const client = {
    auth: {
      async signOut(options) {
        scopes.push(options.scope);
        return { error: null };
      }
    }
  };
  const loaded = loadSessionService();
  const service = loaded.module.create(dependencies(client));

  await service.signOut();
  await service.signOutEverywhere();

  assert.deepEqual(scopes, ["local", "global"]);
  assert.deepEqual(loaded.redirects, [
    "/login/?logged_out=1",
    "/login/?logged_out=1&all_sessions=1"
  ]);
});

test("global sign-out still redirects safely when auth client is unavailable", async function () {
  const loaded = loadSessionService();
  const service = loaded.module.create(dependencies(null));

  await service.signOutEverywhere();

  assert.deepEqual(loaded.redirects, ["/login/?logged_out=1&all_sessions=1"]);
});

test("profile account security UI delegates global logout to Auth service", function () {
  const source = read("account_security_ui.js");
  assert.match(source, /auth\.signOutEverywhere\(\)/);
  assert.doesNotMatch(source, /auth\.signOut\(\{\s*scope:\s*["']global["']/);
});

test("auth infrastructure loads account security only on the profile route", function () {
  const source = read("auth_infrastructure.js");
  assert.match(source, /accountSecurityJs/);
  assert.match(source, /pathname !== PATHS\.profile/);
  assert.match(source, /loadAccountSecurity\(pathname\)/);
});

test("source tree includes the already-applied auth hardening migrations", function () {
  const adminMigration = read(
    "supabase/migrations/20260910163313_harden_auth_admin_identity.sql"
  );
  const healthMigration = read(
    "supabase/migrations/20260910163542_add_auth_account_health_monitoring.sql"
  );

  assert.match(adminMigration, /create or replace function public\.is_teacher_admin\(\)/);
  assert.match(adminMigration, /coalesce\(auth\.jwt\(\) ->> 'aal', 'aal1'\) = 'aal2'/);
  assert.match(healthMigration, /private\.run_auth_account_health_check/);
  assert.match(healthMigration, /'auth-account-health-check','22,52 \* \* \* \*'/);
  assert.match(healthMigration, /'auth_health',latest_auth_health/);
});

test("system health page renders the isolated authentication health block", function () {
  const html = read("saude-do-sistema/index.html");
  const dashboard = read("system_health_dashboard.js");

  assert.match(html, /id="authHealthSummary"/);
  assert.match(html, /id="authHealthIssues"/);
  assert.match(dashboard, /authHealth: normalizeHealthBlock\(dashboard\.auth_health\)/);
  assert.match(dashboard, /renderAuthHealth\(documentRef, dashboard\)/);
});
