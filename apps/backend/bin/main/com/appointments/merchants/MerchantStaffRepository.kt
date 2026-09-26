package com.appointments.merchants

import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

interface MerchantStaffRepository : JpaRepository<MerchantStaffEntity, UUID> {
    fun existsByMerchantIdAndUserId(merchantId: UUID, userId: UUID): Boolean
    fun findByMerchantId(merchantId: UUID): List<MerchantStaffEntity>
    fun findByUserId(userId: UUID): List<MerchantStaffEntity>
}
