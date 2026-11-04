const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("../supabase/functions/_shared/authorize_financial_mcp.mjs");

function mockClient(claims, admin = true, claimsError = null) {
  let calls = 0;
  return {
    auth: { getClaims: async () => ({ data: { claims }, error: claimsError }) },
    rpc: async name => { calls++; assert.equal(name, "is_teacher_admin"); return { data: admin }; },
    calls: () => calls,
  };
}

test("permite apenas professor e aplicativo aprovado", async () => {
  const { authorizeFinancialMcp } = await load();
  const client = mockClient({ sub: "teacher", role: "authenticated", client_id: "approved" });
  assert.deepEqual(await authorizeFinancialMcp(client, "approved"), { userId: "teacher" });
  assert.equal(client.calls(), 1);
});

test("rejeita cliente não configurado, outro aplicativo, credencial inválida e serviço", async () => {
  const { authorizeFinancialMcp } = await load();
  for (const [claims, allowed, error] of [
    [{ sub: "teacher", role: "authenticated", client_id: "approved" }, "", null],
    [{ sub: "teacher", role: "authenticated", client_id: "other" }, "approved", null],
    [{ sub: "teacher", role: "service_role", client_id: "approved" }, "approved", null],
    [{ sub: "teacher", role: "authenticated", client_id: "approved" }, "approved", new Error("invalid")],
  ]) {
    const client = mockClient(claims, true, error);
    await assert.rejects(authorizeFinancialMcp(client, allowed));
    assert.equal(client.calls(), 0);
  }
});

test("recusa usuário que não é administrador", async () => {
  const { authorizeFinancialMcp } = await load();
  const client = mockClient({ sub: "student", role: "authenticated", client_id: "approved" }, false);
  await assert.rejects(authorizeFinancialMcp(client, "approved"), /não autorizado/);
  assert.equal(client.calls(), 1);
});
