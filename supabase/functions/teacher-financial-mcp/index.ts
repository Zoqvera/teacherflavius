import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createMcpHandler, McpServer } from "npm:@modelcontextprotocol/server@2.0.0";
import { pipeline } from "npm:@supabase/middleware@1.0.0";
import { withOAuthProtectedResource, withSupabase } from "npm:@supabase/server@1.6.0";
import { z } from "npm:zod@4.3.6";
import { recordAuthenticatedTuitionPayment } from "../_shared/record_authenticated_tuition_payment.mjs";
import { authorizeFinancialMcp } from "../_shared/authorize_financial_mcp.mjs";

// Fail closed until the OAuth token is proven to have payment-only privileges.
// The ordinary teacher token can authorize other database functions directly.
throw new Error("Integração financeira desativada: autorização limitada ainda não validada.");

// The database RPC independently authorizes the teacher.
Deno.serve(pipeline(
  [withOAuthProtectedResource(), withSupabase({ auth: "user" })],
  async (request, { supabase }) => {
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "teacher-financial", version: "0.1.0" });
      server.registerTool("record_tuition_payment", {
        title: "Registrar pagamento de mensalidade",
        description: "Registra um pagamento de mensalidade informado pelo professor autenticado.",
        inputSchema: z.object({
          tuitionId: z.string().uuid(),
          paymentDate: z.string(),
          amountPaid: z.number().positive(),
          paymentMethod: z.enum(["pix", "cash", "bank_transfer", "card", "other"]),
          notes: z.string().max(1000).optional(),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { securitySchemes: [{ type: "oauth2", scopes: ["openid"] }] },
      }, async (payment) => {
        try {
          await authorizeFinancialMcp(supabase, Deno.env.get("TEACHER_FINANCIAL_OAUTH_CLIENT_ID"));
          const result = await recordAuthenticatedTuitionPayment(supabase, payment);
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch {
          return {
            isError: true,
            content: [{ type: "text" as const, text: "Não foi possível registrar o pagamento. Verifique a sessão, os dados e a situação da mensalidade." }],
          };
        }
      });
      return server;
    });
    return handler.fetch(request);
  },
));
