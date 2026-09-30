package com.appointments.identity

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus

class AuthWebhookControllerTest {

    private val userService = mock(UserService::class.java)
    private val validSecret = "test-webhook-secret-value-12345"

    private lateinit var controller: AuthWebhookController

    @BeforeEach
    fun setup() {
        controller = AuthWebhookController(
            userService = userService,
            webhookSecret = validSecret,
        )
    }

    @Test
    fun `valid secret provisions user and returns 200 OK`() {
        val payload = UserCreatedPayload(
            record = AuthUserRecord(
                id = "auth0|123456",
                email = "user@example.com",
                phone = "+919876543210",
            )
        )

        val response = controller.onUserCreated(
            incomingSecret = validSecret,
            payload = payload,
        )

        assertEquals(HttpStatus.OK, response.statusCode)
        verify(userService, times(1)).provisionUser(
            authRef = "auth0|123456",
            email = "user@example.com",
            phone = "+919876543210",
        )
    }

    @Test
    fun `missing secret returns 401 Unauthorized and rejects provisioning`() {
        val payload = UserCreatedPayload(
            record = AuthUserRecord(
                id = "auth0|attacker",
                email = "attacker@example.com",
                phone = null,
            )
        )

        val response = controller.onUserCreated(
            incomingSecret = null,
            payload = payload,
        )

        assertEquals(HttpStatus.UNAUTHORIZED, response.statusCode)
        verifyNoInteractions(userService)
    }

    @Test
    fun `mismatched secret returns 401 Unauthorized and rejects provisioning`() {
        val payload = UserCreatedPayload(
            record = AuthUserRecord(
                id = "auth0|attacker",
                email = "attacker@example.com",
                phone = null,
            )
        )

        val response = controller.onUserCreated(
            incomingSecret = "wrong-secret",
            payload = payload,
        )

        assertEquals(HttpStatus.UNAUTHORIZED, response.statusCode)
        verifyNoInteractions(userService)
    }

    @Test
    fun `unconfigured secret returns 401 Unauthorized`() {
        val unconfiguredController = AuthWebhookController(
            userService = userService,
            webhookSecret = "",
        )

        val payload = UserCreatedPayload(
            record = AuthUserRecord(
                id = "auth0|user",
                email = "user@example.com",
                phone = null,
            )
        )

        val response = unconfiguredController.onUserCreated(
            incomingSecret = "some-secret",
            payload = payload,
        )

        assertEquals(HttpStatus.UNAUTHORIZED, response.statusCode)
        verifyNoInteractions(userService)
    }
}
