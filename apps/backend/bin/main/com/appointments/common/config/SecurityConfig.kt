package com.appointments.common.config

import com.appointments.common.security.JwtAuthFilter
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpMethod
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter

@Configuration
@EnableWebSecurity
@EnableMethodSecurity(prePostEnabled = true)
class SecurityConfig(private val jwtAuthFilter: JwtAuthFilter) {

    @Bean
    fun filterChain(http: HttpSecurity): SecurityFilterChain {
        http
            .csrf { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests { auth ->
                // Public health / metrics endpoints
                auth.requestMatchers("/actuator/health", "/actuator/info").permitAll()
                auth.requestMatchers("/actuator/prometheus").hasRole("ADMIN")

                // Public read endpoints (browsing merchants, slots)
                auth.requestMatchers(HttpMethod.GET, "/api/v1/cities/**").permitAll()
                auth.requestMatchers(HttpMethod.GET, "/api/v1/merchants/**").permitAll()
                auth.requestMatchers(HttpMethod.GET, "/api/v1/categories/**").permitAll()
                auth.requestMatchers(HttpMethod.GET, "/api/v1/slots/**").permitAll()

                // Webhook from Supabase on user creation
                auth.requestMatchers(HttpMethod.POST, "/api/v1/webhooks/auth/**").permitAll()

                // Everything else requires authentication
                auth.anyRequest().authenticated()
            }
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter::class.java)

        return http.build()
    }
}
