module.exports = [
  {
    files: [
      "accessibility.js",
      "area_do_estudante.js",
      "acessos_dos_alunos.js",
      "auth.js",
      "auth_guard_service.js",
      "auth_infrastructure.js",
      "auth_navigation_service.js",
      "auth_session_service.js",
      "google_auth_ui.js",
      "student_profile_service.js",
      "student_enrollment_service.js",
      "student_data_utils.js",
      "activity_progress_service.js",
      "module_loader.js",
      "supabase_client_service.js"
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script"
    },
    rules: {
      "no-debugger": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-throw-literal": "error",
      "eqeqeq": ["warn", "always"],
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "prefer-const": "warn",
      "no-var": "warn",
      "complexity": ["warn", 15],
      "max-depth": ["warn", 4],
      "max-params": ["warn", 5]
    }
  }
];
