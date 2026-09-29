package com.appointments.availability

import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

interface AvailabilityRuleRepository : JpaRepository<AvailabilityRuleEntity, UUID> {
    fun findByMerchantIdAndResourceIdIsNull(merchantId: UUID): List<AvailabilityRuleEntity>
    fun findByMerchantIdAndResourceId(merchantId: UUID, resourceId: UUID): List<AvailabilityRuleEntity>
    fun findByMerchantId(merchantId: UUID): List<AvailabilityRuleEntity>
}
