package com.appointments.merchants

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import java.util.UUID

interface MerchantRepository : JpaRepository<MerchantEntity, UUID> {
    fun findByCityIdAndStatus(cityId: UUID, status: String): List<MerchantEntity>
    fun findByCityIdAndCategoryIdAndStatus(cityId: UUID, categoryId: UUID, status: String): List<MerchantEntity>
    fun findByOwnerId(ownerId: UUID): List<MerchantEntity>

    @Query("SELECT m FROM MerchantEntity m WHERE m.status = 'PENDING' ORDER BY m.createdAt ASC")
    fun findPending(): List<MerchantEntity>
}
