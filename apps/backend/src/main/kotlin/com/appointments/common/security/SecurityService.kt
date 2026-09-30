package com.appointments.common.security

import com.appointments.availability.AvailabilityRuleRepository
import com.appointments.availability.UpsertRuleRequest
import com.appointments.identity.UserService
import com.appointments.merchants.MerchantRepository
import com.appointments.merchants.MerchantStaffRepository
import org.springframework.context.annotation.Lazy
import org.springframework.security.core.Authentication
import org.springframework.stereotype.Service
import java.util.UUID

@Service("securityService")
class SecurityService(
    private val userService: UserService,
    private val staffRepository: MerchantStaffRepository,
    private val merchantRepository: MerchantRepository,
    @Lazy private val ruleRepository: AvailabilityRuleRepository,
) {

    /**
     * Checks if the authenticated principal is an authorized staff member or owner of the merchant.
     * Platform administrators are granted universal access.
     */
    fun isMerchantStaff(authentication: Authentication?, merchantId: UUID): Boolean {
        if (authentication == null || !authentication.isAuthenticated) return false
        val principal = authentication.principal as? AppPrincipal ?: return false

        // Admin bypass
        if (principal.role == "admin" || authentication.authorities.any { it.authority == "ROLE_ADMIN" }) {
            return true
        }

        val user = userService.findByAuthRef(principal.authRef) ?: return false

        // Check staff membership table
        if (staffRepository.existsByMerchantIdAndUserId(merchantId, user.id)) {
            return true
        }

        // Check if user is the registered merchant owner
        return merchantRepository.findById(merchantId).map { it.ownerId == user.id }.orElse(false)
    }

    /**
     * Validates that all rule upsert requests in a batch belong to a merchant
     * authorized for the authenticated caller.
     */
    fun isMerchantStaffForRules(authentication: Authentication?, rules: List<UpsertRuleRequest>?): Boolean {
        if (rules.isNullOrEmpty()) return true
        return rules.all { isMerchantStaff(authentication, it.merchantId) }
    }

    /**
     * Verifies that the authenticated caller owns or has staff access to the parent merchant of a rule.
     */
    fun isRuleOwner(authentication: Authentication?, ruleId: UUID): Boolean {
        val rule = ruleRepository.findById(ruleId).orElse(null) ?: return false
        return isMerchantStaff(authentication, rule.merchantId)
    }
}
