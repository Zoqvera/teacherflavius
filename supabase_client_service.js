(function () {
  "use strict";

  function getConfig() {
    return window.SUPABASE_CONFIG || null;
  }

  function isConfigured() {
    const config = getConfig();
    return !!(
      config &&
      config.url &&
      config.anonKey &&
      !config.url.includes("COLE_AQUI") &&
      !config.anonKey.includes("COLE_AQUI")
    );
  }

  function getClient() {
    if (!isConfigured()) return null;
    if (!window.supabase || !window.supabase.createClient) return null;

    if (!window.teacherFlavioSupabase) {
      const config = getConfig();
      window.teacherFlavioSupabase = window.supabase.createClient(
        config.url,
        config.anonKey
      );
    }

    return window.teacherFlavioSupabase;
  }

  function requireClient() {
    const client = getClient();
    if (!client) throw new Error("Supabase não configurado.");
    return client;
  }

  window.SupabaseClientService = Object.freeze({
    isConfigured: isConfigured,
    getClient: getClient,
    requireClient: requireClient
  });
})();
