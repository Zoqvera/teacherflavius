const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const client = read("web_push_notifications.js");
const serviceWorker = read("service-worker.js");
const migration = read(
  "supabase/migrations/20261005151500_add_pwa_web_push_notifications.sql"
);
const edgeFunction = read(
  "supabase/functions/send-student-push-notifications/index.ts"
);
const keyMigration = read(
  "supabase/migrations/20261005153500_initialize_pwa_web_push_keys.sql"
);
const initializer = read(
  "supabase/functions/initialize-web-push/index.ts"
);
const bootstrapHardening = read(
  "supabase/migrations/20261005154500_harden_web_push_vapid_bootstrap.sql"
);
const studentArea = read("area_do_estudante.html");

test("PWA notification permission is user initiated and tied to the authenticated student", function () {
  assert.match(client, /Notification\.requestPermission\(\)/);
  assert.match(client, /pushManager\.subscribe/);
  assert.match(client, /userVisibleOnly:\s*true/);
  assert.match(client, /get_web_push_vapid_public_key/);
  assert.match(client, /upsert_my_web_push_subscription/);
  assert.match(client, /delete_my_web_push_subscription/);
  assert.match(client, /Auth\.getSession\(\)/);
  assert.match(client, /isStandalone/);
  assert.match(client, /isNativeCapacitorApp/);
  assert.match(studentArea, /id="pwaPushButton"/);
  assert.match(studentArea, /web_push_notifications\.js/);
});

test("service worker displays Push messages and routes notification clicks", function () {
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /showNotification/);
  assert.match(serviceWorker, /addEventListener\("notificationclick"/);
  assert.match(serviceWorker, /clients\.openWindow/);
  assert.match(serviceWorker, /\/assets\/favicon-192\.png/);
});

test("lesson reminder is sent around thirteen hours before the next real lesson", function () {
  assert.match(migration, /lesson\.starts_at - interval '13 hours' <= now\(\)/);
  assert.match(migration, /lesson\.starts_at - interval '12 hours 50 minutes' > now\(\)/);
  assert.match(migration, /row_number\(\) over \(\s*partition by occurrence\.student_id/);
  assert.match(
    migration,
    /Sua aula está próxima\. Se você não puder participar, ainda dá tempo de cancelar e marcar uma reposição\./
  );
  assert.match(migration, /\/area-do-estudante\/minhas-aulas\//);
});

test("tuition reminders use the requested messages and Sao Paulo local date", function () {
  assert.match(migration, /timezone\('America\/Sao_Paulo', now\(\)\)::date/);
  assert.match(migration, /current_local_date \+ 2/);
  assert.match(migration, /time '09:00'/);
  assert.match(
    migration,
    /Sua mensalidade vence em dois dias, acesse o app e realize o pagamento para garantir sua permanência no curso\./
  );
  assert.match(
    migration,
    /Sua mensalidade vence hoje, acesse o app e realize o pagamento para garantir sua permanência no curso\./
  );
  assert.match(migration, /tuition\.payment_date is null/);
  assert.match(migration, /coalesce\(tuition\.is_exempt, false\) = false/);
});

test("Push credentials are private and delivery is deduplicated", function () {
  assert.match(migration, /private\.web_push_subscriptions/);
  assert.match(migration, /private\.web_push_notification_deliveries/);
  assert.match(migration, /unique \(subscription_id, notification_type, subject_key\)/);
  assert.match(
    migration,
    /revoke all on table private\.web_push_subscriptions from public, anon, authenticated/
  );
  assert.match(migration, /claim_due_web_push_notifications/);
  assert.match(migration, /for update of delivery skip locked/);
});

test("scheduler calls the sender with HMAC authentication", function () {
  assert.match(migration, /teacherflavius_web_push_cron_secret/);
  assert.match(migration, /extensions\.hmac\(request_timestamp, dispatch_secret, 'sha256'\)/);
  assert.match(migration, /x-push-timestamp/);
  assert.match(migration, /x-push-signature/);
  assert.match(migration, /'web-push-notifications'/);
  assert.match(migration, /'\* \* \* \* \*'/);
});

test("Edge Function uses pinned Web Push dependency and handles expired subscriptions", function () {
  assert.match(edgeFunction, /npm:web-push@3\.6\.7/);
  assert.match(edgeFunction, /validate_web_push_dispatch_signature/);
  assert.match(edgeFunction, /get_web_push_vapid_private_key/);
  assert.match(edgeFunction, /get_web_push_vapid_public_key/);
  assert.match(edgeFunction, /claim_due_web_push_notifications/);
  assert.doesNotMatch(edgeFunction, /configure_web_push_vapid_keys/);
  assert.doesNotMatch(edgeFunction, /generateVAPIDKeys/);
  assert.match(edgeFunction, /record_web_push_delivery_result/);
  assert.match(edgeFunction, /statusCode === 404 \|\| statusCode === 410/);
  assert.match(edgeFunction, /setVapidDetails/);
});

test("VAPID private material and cron secret are bootstrapped outside source control", function () {
  assert.match(keyMigration, /extensions\.gen_random_bytes\(48\)/);
  assert.match(keyMigration, /teacherflavius_web_push_cron_secret/);
  assert.match(keyMigration, /configure_web_push_vapid_keys/);
  assert.match(keyMigration, /vault\.create_secret/);
  assert.match(initializer, /auth\.getUser\(token\)/);
  assert.match(initializer, /generateVAPIDKeys/);
  assert.match(initializer, /configure_web_push_vapid_keys/);
  assert.match(bootstrapHardening, /pg_advisory_xact_lock/);
  assert.doesNotMatch(client, /VAPID_PRIVATE_KEY/);
});
