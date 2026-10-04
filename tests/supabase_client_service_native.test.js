const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "supabase_client_service.js"), "utf8");

function execute(native) {
  const calls = [];
  const windowRef = {
    SUPABASE_CONFIG: {
      url: "https://project.supabase.co",
      anonKey: "public-key"
    },
    Capacitor: native
      ? { isNativePlatform: function () { return true; } }
      : undefined,
    supabase: {
      createClient: function () {
        const args = Array.from(arguments);
        calls.push(args);
        return { auth: {} };
      }
    }
  };

  vm.runInNewContext(SOURCE, { window: windowRef });
  windowRef.SupabaseClientService.getClient();

  return calls[0];
}

test("uses PKCE and disables URL session detection inside Capacitor", function () {
  const args = execute(true);

  assert.equal(args[2].auth.flowType, "pkce");
  assert.equal(args[2].auth.detectSessionInUrl, false);
  assert.equal(args[2].auth.persistSession, true);
  assert.equal(args[2].auth.autoRefreshToken, true);
});

test("keeps the browser client configuration unchanged", function () {
  const args = execute(false);
  assert.equal(args[2], undefined);
});
