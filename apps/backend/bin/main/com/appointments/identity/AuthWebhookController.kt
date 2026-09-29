package com.appointments.identity

import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

/**
 * Receives Supabase Auth webhook on user.created event.
 * Supabase sends this via Database Webhooks → HTTP → this endpoint.
 *
 * Webhook payload reference:
 * https://supabase.com/docs/guides/database/webhooks
 */
@RestController
@RequestMapping("/api/v1/webhooks/auth")
class AuthWebhookController(private val userService: UserService) {

    @PostMapping("/user-created")
    fun onUserCreated(@RequestBody payload: UserCreatedPayload): ResponseEntity<Void> {
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
