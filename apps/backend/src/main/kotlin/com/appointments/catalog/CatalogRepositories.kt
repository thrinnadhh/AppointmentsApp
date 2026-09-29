package com.appointments.catalog

import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

interface ServiceRepository : JpaRepository<ServiceEntity, UUID> {
    fun findByMerchantIdAndIsActiveTrue(merchantId: UUID): List<ServiceEntity>
    fun findByMerchantId(merchantId: UUID): List<ServiceEntity>
}

interface ResourceRepository : JpaRepository<ResourceEntity, UUID> {
    fun findByMerchantIdAndIsActiveTrue(merchantId: UUID): List<ResourceEntity>
    fun findByMerchantId(merchantId: UUID): List<ResourceEntity>
}

interface CategoryRepository : JpaRepository<CategoryEntity, UUID>
