import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import { createResendDeliveryHandler } from "../_shared/resend_delivery_handler.mjs";

function secretKey(): string {
  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (encoded) {
    try {
      const defaultKey = (JSON.parse(encoded) as { default?: unknown }).default;
      if (typeof defaultKey === "string" && defaultKey) return defaultKey;
    } catch {
      // Legacy service-role secret remains supported.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

Deno.serve(createResendDeliveryHandler({
  readConfiguration: () => ({
    enabled: Deno.env.get("RESEND_DELIVERY_TRACKING_ENABLED") === "true",
    signingSecret: Deno.env.get("RESEND_WEBHOOK_SIGNING_SECRET") ?? "",
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    adminKey: secretKey(),
  }),
  createAdminClient: (url: string, key: string) => createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  logError: () => console.error("Resend delivery webhook", "persistence_failed"),
}));
