package com.appointments.identity

import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.security.MessageDigest

/**
 * Receives Supabase Auth webhook on user.created event.
 * Supabase sends this via Database Webhooks → HTTP → this endpoint.
 *
 * Webhook payload reference:
 * https://supabase.com/docs/guides/database/webhooks
 */
@RestController
@RequestMapping("/api/v1/webhooks/auth")
class AuthWebhookController(
    private val userService: UserService,
    @Value("\${app.auth-webhook-secret:}") private val webhookSecret: String = "",
) {

    @PostMapping("/user-created")
    fun onUserCreated(
        @RequestHeader(value = "X-Webhook-Secret", required = false) incomingSecret: String?,
        @RequestBody payload: UserCreatedPayload,
    ): ResponseEntity<Void> {
        if (webhookSecret.isBlank() || incomingSecret.isNullOrBlank() ||
            !MessageDigest.isEqual(incomingSecret.toByteArray(Charsets.UTF_8), webhookSecret.toByteArray(Charsets.UTF_8))
        ) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()
        }

        userService.provisionUser(
            authRef = payload.record.id,
            email   = payload.record.email,
            phone   = payload.record.phone,
        )
        return ResponseEntity.ok().build()
    }
}

data class UserCreatedPayload(val record: AuthUserRecord)
data class AuthUserRecord(val id: String, val email: String?, val phone: String?)
