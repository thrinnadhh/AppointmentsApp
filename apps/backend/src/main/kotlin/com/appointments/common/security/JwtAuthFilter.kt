package com.appointments.common.security

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

@Component
class JwtAuthFilter(private val jwtValidator: JwtValidator) : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        chain: FilterChain,
    ) {
        val token = extractBearer(request)
        if (token != null) {
            val claims = jwtValidator.validate(token)
            if (claims != null) {
                val authRef = claims.subject                             // Supabase user ID
                val role    = claims["role"]?.toString() ?: "customer"  // custom claim set by DB trigger
                val auth = UsernamePasswordAuthenticationToken(
                    AppPrincipal(authRef = authRef, role = role),
                    null,
                    listOf(SimpleGrantedAuthority("ROLE_${role.uppercase()}")),
                )
                auth.details = WebAuthenticationDetailsSource().buildDetails(request)
                SecurityContextHolder.getContext().authentication = auth
            }
        }
        chain.doFilter(request, response)
    }

    private fun extractBearer(request: HttpServletRequest): String? =
        request.getHeader("Authorization")
            ?.takeIf { it.startsWith("Bearer ") }
            ?.substring(7)
}
