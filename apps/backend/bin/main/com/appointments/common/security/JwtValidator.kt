package com.appointments.common.security

import io.jsonwebtoken.Claims
import io.jsonwebtoken.Jwts
import io.jsonwebtoken.security.Keys
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.nio.charset.StandardCharsets

/**
 * Validates JWT tokens issued by Supabase Auth.
 * Supabase signs tokens with the project's JWT secret (HS256).
 */
@Component
class JwtValidator(
    @Value("\${app.auth.jwt-secret}") private val secret: String,
    @Value("\${app.auth.jwt-issuer}") private val issuer: String,
    @Value("\${app.auth.jwt-audience}") private val audience: String,
) {
    private val key by lazy {
        Keys.hmacShaKeyFor(secret.toByteArray(StandardCharsets.UTF_8))
    }

    /**
     * Returns parsed claims, or null if the token is invalid/expired.
     */
    fun validate(token: String): Claims? = runCatching {
        Jwts.parser()
            .verifyWith(key)
            .requireIssuer(issuer)
            .requireAudience(audience)
            .build()
            .parseSignedClaims(token)
            .payload
    }.getOrNull()
}
