#!/usr/bin/env python3
from __future__ import annotations

from script_dependency_spec import ScriptDependencySpec

AUTH_DEPENDENCIES = (
    ScriptDependencySpec(
        dependency_src="/supabase_client_service.js?v=20260902-1",
        dependency_filename="supabase_client_service.js",
        target_filename="auth.js",
        validation_message="Dependencies must load before auth.js in: {path} (Supabase client service)",
    ),
    ScriptDependencySpec(
        dependency_src="/auth_navigation_service.js?v=20260902-1",
        dependency_filename="auth_navigation_service.js",
        target_filename="auth.js",
        validation_message="Dependencies must load before auth.js in: {path} (Auth navigation service)",
    ),
    ScriptDependencySpec(
        dependency_src="/student_data_utils.js?v=20260902-1",
        dependency_filename="student_data_utils.js",
        target_filename="auth.js",
        validation_message="Dependencies must load before auth.js in: {path} (Student data utilities)",
    ),
    ScriptDependencySpec(
        dependency_src="/student_enrollment_service.js?v=20260902-1",
        dependency_filename="student_enrollment_service.js",
        target_filename="auth.js",
        validation_message="Dependencies must load before auth.js in: {path} (Student enrollment service)",
    ),
)

ANALYTICS_DEPENDENCIES = (
    ScriptDependencySpec(
        dependency_src="/analytics_utils.js?v=20260902-1",
        dependency_filename="analytics_utils.js",
        target_filename="analytics.js",
        validation_message="Dependencies must load before analytics.js in: {path} (Analytics utilities)",
    ),
    ScriptDependencySpec(
        dependency_src="/analytics_acquisition.js?v=20260902-1",
        dependency_filename="analytics_acquisition.js",
        target_filename="analytics.js",
        validation_message="Dependencies must load before analytics.js in: {path} (Analytics acquisition)",
    ),
    ScriptDependencySpec(
        dependency_src="/analytics_forms.js?v=20260902-1",
        dependency_filename="analytics_forms.js",
        target_filename="analytics.js",
        validation_message="Dependencies must load before analytics.js in: {path} (Analytics forms)",
    ),
    ScriptDependencySpec(
        dependency_src="/analytics_payments.js?v=20260902-1",
        dependency_filename="analytics_payments.js",
        target_filename="analytics.js",
        validation_message="Dependencies must load before analytics.js in: {path} (Analytics payments)",
    ),
)

PORTAL_HELPER_DEPENDENCIES = (
    ScriptDependencySpec(
        dependency_src="/resource_waiter.js?v=20260902-2",
        dependency_filename="resource_waiter.js",
        target_filename="site_footer.js",
        validation_message="Dependencies must load before site_footer.js in: {path} (Resource waiter)",
    ),
)

DEPENDENCY_GROUPS = (
    AUTH_DEPENDENCIES,
    ANALYTICS_DEPENDENCIES,
    PORTAL_HELPER_DEPENDENCIES,
)
