"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTIONS } = require("../agents/academic_secretary");
const {
  createSupabaseAcademicReaders,
  createAcademicSecretarySupabaseService
} = require("../agents/academic_secretary_supabase");

const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const CLASS_NUMBER = 25;

function fixture(overrides = {}) {
  const calls = [];
  const state = {
    signedIn: true,
    teacher: true,
    profile: { id: STUDENT_ID, archived: false },
    memberships: [{ class_number: 14 }],
    academicClass: { class_number: CLASS_NUMBER, class_type: "quintet", is_active: true },
    availability: [{ class_number: CLASS_NUMBER, available_spots: 2, sold_out: false }],
    ...overrides
  };
  const client = {
    auth: {
      async getUser() {
        calls.push("auth.getUser");
        return { data: { user: state.signedIn ? { id: "teacher" } : null }, error: null };
      }
    },
    async rpc(name) {
      calls.push("rpc." + name);
      if (name === "is_teacher_admin") return { data: state.teacher, error: null };
      if (name === "get_public_class_seat_availability") {
        return { data: state.availability, error: null };
      }
      throw new Error("Unexpected RPC: " + name);
    },
    from(name) {
      calls.push("from." + name);
      if (!["profiles", "class_students", "teacher_classes"].includes(name)) {
        throw new Error("Unexpected table: " + name);
      }
      let filterKey;
      let filterValue;
      const query = {
        select(fields) {
          calls.push("select." + name + "." + fields);
          return this;
        },
        eq(key, value) {
          filterKey = key;
          filterValue = value;
          calls.push("eq." + name + "." + key);
          return this;
        },
        async maybeSingle() {
          if (name === "profiles") {
            assert.equal(filterKey, "id");
            assert.equal(filterValue, STUDENT_ID);
            return { data: state.profile, error: null };
          }
          if (name === "teacher_classes") {
            assert.equal(filterKey, "class_number");
            assert.equal(filterValue, CLASS_NUMBER);
            return { data: state.academicClass, error: null };
          }
          throw new Error("Unexpected maybeSingle");
        },
        then(resolve, reject) {
          if (name !== "class_students") {
            throw new Error("Unexpected array query");
          }
          assert.equal(filterKey, "user_id");
          assert.equal(filterValue, STUDENT_ID);
          return Promise.resolve({ data: state.memberships, error: null }).then(resolve, reject);
        }
      };
      return query;
    }
  };
  return { client, calls };
}

test("adapter rejects missing authentication dependencies", () => {
  assert.throws(() => createSupabaseAcademicReaders({}), /Supabase autenticado/);
});

test("student snapshot is minimal and uses authenticated administrative reads", async () => {
  const { client, calls } = fixture();
  const readers = createSupabaseAcademicReaders(client);
  const result = await readers.getStudentSnapshot(STUDENT_ID);
  assert.deepEqual(result, { id: STUDENT_ID, archived: false, classNumbers: [14] });
  assert.deepEqual(Object.keys(result).sort(), ["archived", "classNumbers", "id"]);
  assert.ok(calls.includes("rpc.is_teacher_admin"));
  assert.ok(calls.includes("select.profiles.id,archived"));
  assert.ok(calls.includes("select.class_students.class_number"));
  assert.equal(calls.some(call => call.startsWith("rpc.set_")), false);
});

test("anonymous and non-admin callers cannot inspect student records", async () => {
  for (const state of [{ signedIn: false }, { teacher: false }]) {
    const { client, calls } = fixture(state);
    await assert.rejects(
      createSupabaseAcademicReaders(client).getStudentSnapshot(STUDENT_ID),
      /não autorizado/
    );
    assert.equal(calls.some(call => call.startsWith("from.")), false);
  }
});

test("invalid student identifiers are rejected before querying", async () => {
  const { client, calls } = fixture();
  await assert.rejects(
    createSupabaseAcademicReaders(client).getStudentSnapshot("student-001"),
    /Identificador/
  );
  assert.deepEqual(calls, []);
});

test("archived profiles and duplicate memberships are not silently normalized", async () => {
  const archived = fixture({ profile: { id: STUDENT_ID, archived: true } });
  const snapshot = await createSupabaseAcademicReaders(archived.client)
    .getStudentSnapshot(STUDENT_ID);
  assert.equal(snapshot.archived, true);

  const broken = fixture({ memberships: [{ class_number: 14 }, { class_number: 14 }] });
  await assert.rejects(
    createSupabaseAcademicReaders(broken.client).getStudentSnapshot(STUDENT_ID),
    /inconsistências/
  );
});

test("class availability comes from RPC that includes active seat reservations", async () => {
  const { client, calls } = fixture();
  const snapshot = await createSupabaseAcademicReaders(client)
    .getClassSnapshot(CLASS_NUMBER);
  assert.deepEqual(snapshot, { number: CLASS_NUMBER, availableSeats: 2 });
  assert.ok(calls.includes("rpc.get_public_class_seat_availability"));
  assert.equal(calls.includes("rpc.get_teacher_class_seat_leads"), false);
});

test("full class blocks new links in the read-only planner", async () => {
  const { client } = fixture({
    availability: [{ class_number: CLASS_NUMBER, available_spots: 0, sold_out: true }]
  });
  const agent = createAcademicSecretarySupabaseService(client);
  const result = await agent.plan({
    action: ACTIONS.NEW_LINK, studentId: STUDENT_ID, classNumber: CLASS_NUMBER,
    source: "facebook", firstLessonDate: "2026-11-09"
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.readOnly, true);
  assert.match(result.blockers.join(" "), /sem vagas/);
});

test("transfers use live membership and never request origin or first lesson", async () => {
  const { client } = fixture();
  const result = await createAcademicSecretarySupabaseService(client).plan({
    action: ACTIONS.TRANSFER, studentId: STUDENT_ID,
    classNumber: CLASS_NUMBER, fromClassNumber: 14
  });
  assert.equal(result.status, "ready_for_review");
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.requiresAtomicExecution, true);
  assert.equal(result.readOnly, true);
});

test("missing, inactive and non-group classes fail closed", async () => {
  for (const state of [
    { academicClass: null },
    { academicClass: { class_number: CLASS_NUMBER, class_type: "quintet", is_active: false } },
    { academicClass: { class_number: CLASS_NUMBER, class_type: "individual", is_active: true } }
  ]) {
    const { client, calls } = fixture(state);
    await assert.rejects(
      createSupabaseAcademicReaders(client).getClassSnapshot(CLASS_NUMBER),
      /inativa|modalidade/
    );
    assert.equal(calls.includes("rpc.get_public_class_seat_availability"), false);
  }
});

test("missing or inconsistent public availability fails closed", async () => {
  for (const availability of [
    [], [{ class_number: CLASS_NUMBER, available_spots: "1", sold_out: false }],
    [{ class_number: CLASS_NUMBER, available_spots: 0, sold_out: false }]
  ]) {
    const { client } = fixture({ availability });
    await assert.rejects(
      createSupabaseAcademicReaders(client).getClassSnapshot(CLASS_NUMBER),
      /não verificável/
    );
  }
});

test("student lookup failures are not treated as empty class assignments", async () => {
  const missing = fixture({ memberships: null });
  await assert.rejects(
    createSupabaseAcademicReaders(missing.client).getStudentSnapshot(STUDENT_ID),
    /todos os vínculos/
  );
});

test("agent plans cannot mutate data through the adapter", async () => {
  const { client, calls } = fixture();
  const result = await createAcademicSecretarySupabaseService(client).plan({
    action: ACTIONS.ARCHIVE, studentId: STUDENT_ID
  });
  assert.equal(result.readOnly, true);
  assert.equal(result.status, "ready_for_review");
  assert.equal(calls.some(call => /(insert|update|delete|upsert|archive_teacher_student)/.test(call)), false);
});
