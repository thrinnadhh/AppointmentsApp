package com.appointments.common.security

/**
 * Request-scoped principal extracted from the validated JWT.
 * authRef = Supabase auth.users.id (used to look up our internal users table).
 */
data class AppPrincipal(
    val authRef: String,
    val role: String,
)
