// This is an additional server-side check, not a restriction on the token's
// direct access to Supabase APIs. The integration must stay disabled until
// independent least-privilege enforcement is in place.
export async function authorizeFinancialMcp(client, allowedClientId) {
  if (typeof allowedClientId !== "string" || !allowedClientId.trim()) {
    throw new Error("Aplicativo autorizado não configurado.");
  }

  const { data, error } = await client.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || claims.role !== "authenticated" ||
      typeof claims.sub !== "string" || !claims.sub ||
      claims.client_id !== allowedClientId) {
    throw new Error("Acesso não autorizado.");
  }

  const result = await client.rpc("is_teacher_admin");
  if (result.error || result.data !== true) {
    throw new Error("Acesso não autorizado.");
  }
  return { userId: claims.sub };
}
