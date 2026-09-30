package com.appointments.availability

import com.appointments.common.security.AppPrincipal
import com.appointments.common.security.SecurityService
import com.appointments.identity.UserService
import com.appointments.merchants.MerchantRepository
import com.appointments.merchants.MerchantStaffRepository
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.security.access.AccessDeniedException
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import java.time.LocalTime
import java.util.Optional
import java.util.UUID

/**
 * SlotRuleSecurityIntegrationTest
 *
 * Verifies BOLA access control, tenant boundary enforcement, and rule ownership
 * checks for PUT /api/v1/slots/rules and PUT /api/v1/slots/rules/{ruleId}.
 */
class SlotRuleSecurityIntegrationTest {

    private val availabilityService = mock(AvailabilityService::class.java)
    private val ruleRepository = mock(AvailabilityRuleRepository::class.java)
    private val userService = mock(UserService::class.java)
    private val staffRepository = mock(MerchantStaffRepository::class.java)
    private val merchantRepository = mock(MerchantRepository::class.java)

    private lateinit var securityService: SecurityService
    private lateinit var controller: AvailabilityController

    private val merchantAId = UUID.fromString("11111111-1111-1111-1111-111111111111")
    private val merchantBId = UUID.fromString("22222222-2222-2222-2222-222222222222")
    private val ruleBId = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")

    @BeforeEach
    fun setup() {
        securityService = SecurityService(
            userService = userService,
            staffRepository = staffRepository,
            merchantRepository = merchantRepository,
            ruleRepository = ruleRepository,
        )
        controller = AvailabilityController(
            availabilityService = availabilityService,
            ruleRepository = ruleRepository,
        )
    }

    @Test
    fun `Merchant A cannot mutate Venue B slot rule - securityService rejects with false`() {
        val merchantAPrincipal = AppPrincipal(authRef = "merchant-a-auth-ref", role = "merchant")
        val merchantAAuth = UsernamePasswordAuthenticationToken(
            merchantAPrincipal,
            null,
            listOf(SimpleGrantedAuthority("ROLE_MERCHANT")),
        )

        // Rule belongs to Merchant B
        val ruleB = AvailabilityRuleEntity(
            id = ruleBId,
            merchantId = merchantBId,
            dayOfWeek = 1,
            openTime = LocalTime.of(9, 0),
            closeTime = LocalTime.of(17, 0),
            isClosed = false,
        )
        `when`(ruleRepository.findById(ruleBId)).thenReturn(Optional.of(ruleB))

        // Merchant A staff check returns false for Merchant B
        val isOwner = securityService.isRuleOwner(merchantAAuth, ruleBId)
        assertFalse(isOwner, "Merchant A must not be authorized as rule owner for Merchant B's rule")
    }

    @Test
    fun `Merchant A cannot bulk upsert rules for Venue B - securityService rejects with false`() {
        val merchantAPrincipal = AppPrincipal(authRef = "merchant-a-auth-ref", role = "merchant")
        val merchantAAuth = UsernamePasswordAuthenticationToken(
            merchantAPrincipal,
            null,
            listOf(SimpleGrantedAuthority("ROLE_MERCHANT")),
        )

        val tamperedRules = listOf(
            UpsertRuleRequest(
                merchantId = merchantBId,
                resourceId = null,
                dayOfWeek = 1,
                openTime = LocalTime.of(8, 0),
                closeTime = LocalTime.of(20, 0),
                isClosed = false,
            )
        )

        val isAuthorized = securityService.isMerchantStaffForRules(merchantAAuth, tamperedRules)
        assertFalse(isAuthorized, "Merchant A must not be authorized to bulk upsert rules for Merchant B")
    }

    @Test
    fun `Merchant B owner can mutate their own slot rule - securityService approves`() {
        val merchantBPrincipal = AppPrincipal(authRef = "merchant-b-auth-ref", role = "merchant")
        val merchantBAuth = UsernamePasswordAuthenticationToken(
            merchantBPrincipal,
            null,
            listOf(SimpleGrantedAuthority("ROLE_MERCHANT")),
        )

        val userB = com.appointments.identity.UserEntity(
            id = UUID.fromString("99999999-9999-9999-9999-999999999992"),
            authRef = "merchant-b-auth-ref",
            email = "merchant-b@example.com",
            role = "merchant",
        )
        `when`(userService.findByAuthRef("merchant-b-auth-ref")).thenReturn(userB)
        `when`(staffRepository.existsByMerchantIdAndUserId(merchantBId, userB.id)).thenReturn(true)

        val ruleB = AvailabilityRuleEntity(
            id = ruleBId,
            merchantId = merchantBId,
            dayOfWeek = 1,
            openTime = LocalTime.of(9, 0),
            closeTime = LocalTime.of(17, 0),
            isClosed = false,
        )
        `when`(ruleRepository.findById(ruleBId)).thenReturn(Optional.of(ruleB))

        val isOwner = securityService.isRuleOwner(merchantBAuth, ruleBId)
        assertTrue(isOwner, "Merchant B staff must be authorized for Merchant B's rule")
    }

    @Test
    fun `Admin has universal permission to update rules across all venues`() {
        val adminPrincipal = AppPrincipal(authRef = "admin-sub", role = "admin")
        val adminAuth = UsernamePasswordAuthenticationToken(
            adminPrincipal,
            null,
            listOf(SimpleGrantedAuthority("ROLE_ADMIN")),
        )

        val ruleB = AvailabilityRuleEntity(
            id = ruleBId,
            merchantId = merchantBId,
            dayOfWeek = 1,
            openTime = LocalTime.of(9, 0),
            closeTime = LocalTime.of(17, 0),
            isClosed = false,
        )
        `when`(ruleRepository.findById(ruleBId)).thenReturn(Optional.of(ruleB))

        val isOwner = securityService.isRuleOwner(adminAuth, ruleBId)
        assertTrue(isOwner, "Admin must have universal access")
    }
}
