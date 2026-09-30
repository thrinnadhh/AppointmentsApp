package com.appointments.availability

import org.springframework.format.annotation.DateTimeFormat
import org.springframework.web.bind.annotation.*
import java.time.LocalDate
import java.util.UUID

import com.appointments.common.errors.NotFoundException
import org.springframework.security.access.prepost.PreAuthorize

@RestController
@RequestMapping("/api/v1/slots", "/slots")
class AvailabilityController(
    private val availabilityService: AvailabilityService,
    private val ruleRepository: AvailabilityRuleRepository,
) {

    /** Public — get available slots for a merchant on a given date */
    @GetMapping
    fun getSlots(
        @RequestParam merchantId: UUID,
        @RequestParam(required = false) resourceId: UUID?,
        @RequestParam serviceMin: Int,
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) date: LocalDate,
        @RequestParam(defaultValue = "Asia/Kolkata") tz: String,
    ) = availabilityService.getSlots(merchantId, resourceId, serviceMin, date, tz)

    /** Merchant staff — set weekly schedule */
    @PutMapping("/rules")
    @PreAuthorize("hasRole('ADMIN') or @securityService.isMerchantStaffForRules(authentication, #rules)")
    fun upsertRules(
        @RequestBody rules: List<UpsertRuleRequest>,
    ): List<AvailabilityRuleEntity> {
        if (rules.isEmpty()) return emptyList()
        // Simple bulk save — validation left to DB constraint
        return ruleRepository.saveAll(rules.map {
            AvailabilityRuleEntity(
                merchantId = it.merchantId,
                resourceId = it.resourceId,
                dayOfWeek  = it.dayOfWeek,
                openTime   = it.openTime,
                closeTime  = it.closeTime,
                isClosed   = it.isClosed,
            )
        })
    }

    /** Merchant staff — update single rule */
    @PutMapping("/rules/{ruleId}")
    @PreAuthorize("hasRole('ADMIN') or @securityService.isRuleOwner(authentication, #ruleId)")
    fun updateRule(
        @PathVariable ruleId: UUID,
        @RequestBody req: UpsertRuleRequest,
    ): AvailabilityRuleEntity {
        val existing = ruleRepository.findById(ruleId)
            .orElseThrow { NotFoundException("Rule not found: $ruleId") }
        return ruleRepository.save(
            AvailabilityRuleEntity(
                id = existing.id,
                merchantId = existing.merchantId,
                resourceId = req.resourceId ?: existing.resourceId,
                dayOfWeek  = req.dayOfWeek,
                openTime   = req.openTime,
                closeTime  = req.closeTime,
                isClosed   = req.isClosed,
            )
        )
    }
}

data class UpsertRuleRequest(
    val merchantId: UUID,
    val resourceId: UUID?,
    val dayOfWeek: Int,
    val openTime: java.time.LocalTime,
    val closeTime: java.time.LocalTime,
    val isClosed: Boolean = false,
)
