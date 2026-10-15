(function (root) {
  "use strict";

  const ACCESS = Object.freeze({
    TEACHER: "teacher",
    UNAUTHENTICATED: "unauthenticated",
    FORBIDDEN: "forbidden",
    UNAVAILABLE: "unavailable"
  });

  async function resolveAccess(auth) {
    if (!auth || typeof auth.isConfigured !== "function" ||
        typeof auth.getSession !== "function" || typeof auth.getClient !== "function") {
      return ACCESS.UNAVAILABLE;
    }

    try {
      if (!auth.isConfigured()) return ACCESS.UNAVAILABLE;

      const session = await auth.getSession();
      if (!session || !session.user) return ACCESS.UNAUTHENTICATED;

      const client = auth.getClient();
      if (!client || typeof client.rpc !== "function") return ACCESS.UNAVAILABLE;

      const result = await client.rpc("is_teacher_admin");
      if (!result || result.error) return ACCESS.UNAVAILABLE;

      return result.data === true ? ACCESS.TEACHER : ACCESS.FORBIDDEN;
    } catch (error) {
      return ACCESS.UNAVAILABLE;
    }
  }

  root.HomeworkAccessService = Object.freeze({
    ACCESS: ACCESS,
    resolveAccess: resolveAccess
  });
})(window);
