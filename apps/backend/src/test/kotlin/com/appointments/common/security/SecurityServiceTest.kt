package com.appointments.common.security

import com.appointments.availability.AvailabilityRuleEntity
import com.appointments.availability.AvailabilityRuleRepository
import com.appointments.availability.UpsertRuleRequest
import com.appointments.identity.UserEntity
import com.appointments.identity.UserService
import com.appointments.merchants.MerchantEntity
import com.appointments.merchants.MerchantRepository
import com.appointments.merchants.MerchantStaffRepository
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import java.time.LocalTime
import java.util.Optional
import java.util.UUID

class SecurityServiceTest {

    private val userService = mock(UserService::class.java)
    private val staffRepository = mock(MerchantStaffRepository::class.java)
    private val merchantRepository = mock(MerchantRepository::class.java)
    private val ruleRepository = mock(AvailabilityRuleRepository::class.java)

    private lateinit var securityService: SecurityService

    @BeforeEach
    fun setup() {
        securityService = SecurityService(
            userService = userService,
            staffRepository = staffRepository,
            merchantRepository = merchantRepository,
            ruleRepository = ruleRepository,
        )
    }

    @Test
    fun `admin authentication has universal access`() {
        val adminPrincipal = AppPrincipal(authRef = "admin-sub", role = "admin")
        val auth = UsernamePasswordAuthenticationToken(
            adminPrincipal,
            null,
            listOf(SimpleGrantedAuthority("ROLE_ADMIN")),
        )

        val merchantId = UUID.randomUUID()
        assertTrue(securityService.isMerchantStaff(auth, merchantId))
    }

    @Test
    fun `unauthenticated or null returns false`() {
        val merchantId = UUID.randomUUID()
        assertFalse(securityService.isMerchantStaff(null, merchantId))
    }

    @Test
    fun `authorized merchant staff member returns true`() {
        val staffPrincipal = AppPrincipal(authRef = "staff-sub", role = "merchant_staff")
        val auth = UsernamePasswordAuthenticationToken(
            staffPrincipal,
            null,
            listOf(SimpleGrantedAuthority("ROLE_MERCHANT_STAFF")),
        )

        val merchantId = UUID.randomUUID()
        val userId = UUID.randomUUID()
        val user = UserEntity(id = userId, authRef = "staff-sub", email = "staff@test.com", role = "merchant_staff")

        `when`(userService.findByAuthRef("staff-sub")).thenReturn(user)
        `when`(staffRepository.existsByMerchantIdAndUserId(merchantId, userId)).thenReturn(true)

        assertTrue(securityService.isMerchantStaff(auth, merchantId))
    }

    @Test
    fun `merchant owner returns true even if not in staff table`() {
        val ownerPrincipal = AppPrincipal(authRef = "owner-sub", role = "merchant")
        val auth = UsernamePasswordAuthenticationToken(
            ownerPrincipal,
            null,
            listOf(SimpleGrantedAuthority("ROLE_MERCHANT")),
        )

        val merchantId = UUID.randomUUID()
        val userId = UUID.randomUUID()
        val user = UserEntity(id = userId, authRef = "owner-sub", email = "owner@test.com", role = "merchant")
        val merchant = MerchantEntity(
            id = merchantId,
            cityId = UUID.randomUUID(),
            ownerId = userId,
            categoryId = UUID.randomUUID(),
            name = "Test Venue",
        )

        `when`(userService.findByAuthRef("owner-sub")).thenReturn(user)
        `when`(staffRepository.existsByMerchantIdAndUserId(merchantId, userId)).thenReturn(false)
        `when`(merchantRepository.findById(merchantId)).thenReturn(Optional.of(merchant))

        assertTrue(securityService.isMerchantStaff(auth, merchantId))
    }

    @Test
    fun `unauthorized merchant staff returns false for arbitrary merchant ID (BOLA prevention)`() {
        val callerPrincipal = AppPrincipal(authRef = "attacker-sub", role = "merchant_staff")
        val auth = UsernamePasswordAuthenticationToken(
            callerPrincipal,
            null,
            listOf(SimpleGrantedAuthority("ROLE_MERCHANT_STAFF")),
        )

        val victimMerchantId = UUID.randomUUID()
        val userId = UUID.randomUUID()
        val user = UserEntity(id = userId, authRef = "attacker-sub", email = "attacker@test.com", role = "merchant_staff")

        `when`(userService.findByAuthRef("attacker-sub")).thenReturn(user)
        `when`(staffRepository.existsByMerchantIdAndUserId(victimMerchantId, userId)).thenReturn(false)
        `when`(merchantRepository.findById(victimMerchantId)).thenReturn(Optional.empty())

        assertFalse(securityService.isMerchantStaff(auth, victimMerchantId))
    }

    @Test
    fun `isRuleOwner checks parent merchant authorization`() {
        val staffPrincipal = AppPrincipal(authRef = "staff-sub", role = "merchant_staff")
        val auth = UsernamePasswordAuthenticationToken(
            staffPrincipal,
            null,
            listOf(SimpleGrantedAuthority("ROLE_MERCHANT_STAFF")),
        )

        val ruleId = UUID.randomUUID()
        val merchantId = UUID.randomUUID()
        val userId = UUID.randomUUID()
        val user = UserEntity(id = userId, authRef = "staff-sub", email = "staff@test.com", role = "merchant_staff")
        val rule = AvailabilityRuleEntity(
            id = ruleId,
            merchantId = merchantId,
            dayOfWeek = 1,
            openTime = LocalTime.of(9, 0),
            closeTime = LocalTime.of(17, 0),
        )

        `when`(ruleRepository.findById(ruleId)).thenReturn(Optional.of(rule))
        `when`(userService.findByAuthRef("staff-sub")).thenReturn(user)
        `when`(staffRepository.existsByMerchantIdAndUserId(merchantId, userId)).thenReturn(true)

        assertTrue(securityService.isRuleOwner(auth, ruleId))
    }

    @Test
    fun `isMerchantStaffForRules verifies all rules in batch`() {
        val staffPrincipal = AppPrincipal(authRef = "staff-sub", role = "merchant_staff")
        val auth = UsernamePasswordAuthenticationToken(
            staffPrincipal,
            null,
            listOf(SimpleGrantedAuthority("ROLE_MERCHANT_STAFF")),
        )

        val merchantIdA = UUID.randomUUID()
        val merchantIdB = UUID.randomUUID()
        val userId = UUID.randomUUID()
        val user = UserEntity(id = userId, authRef = "staff-sub", email = "staff@test.com", role = "merchant_staff")

        `when`(userService.findByAuthRef("staff-sub")).thenReturn(user)
        `when`(staffRepository.existsByMerchantIdAndUserId(merchantIdA, userId)).thenReturn(true)
        `when`(staffRepository.existsByMerchantIdAndUserId(merchantIdB, userId)).thenReturn(false)
        `when`(merchantRepository.findById(merchantIdB)).thenReturn(Optional.empty())

        val rules = listOf(
            UpsertRuleRequest(merchantId = merchantIdA, resourceId = null, dayOfWeek = 1, openTime = LocalTime.of(9, 0), closeTime = LocalTime.of(17, 0)),
            UpsertRuleRequest(merchantId = merchantIdB, resourceId = null, dayOfWeek = 2, openTime = LocalTime.of(9, 0), closeTime = LocalTime.of(17, 0)),
        )

        assertFalse(securityService.isMerchantStaffForRules(auth, rules))
    }
}
