package com.appointments.catalog

import com.appointments.common.errors.NotFoundException
import com.appointments.merchants.MerchantService
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.math.BigDecimal
import java.util.UUID

@Service
class CatalogService(
    private val serviceRepository: ServiceRepository,
    private val resourceRepository: ResourceRepository,
    private val categoryRepository: CategoryRepository,
    private val merchantService: MerchantService,
) {
    // ── Categories ──────────────────────────────────────────────────────────
    fun listCategories(): List<CategoryEntity> = categoryRepository.findAll().toList()

    // ── Services ────────────────────────────────────────────────────────────
    fun listServices(merchantId: UUID, includeInactive: Boolean = false): List<ServiceEntity> =
        if (includeInactive) serviceRepository.findByMerchantId(merchantId)
        else serviceRepository.findByMerchantIdAndIsActiveTrue(merchantId)

    fun getService(id: UUID): ServiceEntity =
        serviceRepository.findById(id).orElseThrow { NotFoundException("Service not found: $id") }

    @Transactional
    fun createService(
        merchantId: UUID,
        authRef: String,
        name: String,
        durationMin: Int,
        depositAmt: BigDecimal,
    ): ServiceEntity {
        val merchant = merchantService.getById(merchantId)
        merchantService.requireOwnerOrAdmin(merchant, authRef)
        return serviceRepository.save(
            ServiceEntity(merchantId = merchantId, name = name, durationMin = durationMin, depositAmt = depositAmt)
        )
    }

    @Transactional
    fun toggleService(id: UUID, merchantId: UUID, authRef: String, active: Boolean): ServiceEntity {
        val merchant = merchantService.getById(merchantId)
        merchantService.requireOwnerOrAdmin(merchant, authRef)
        val svc = getService(id)
        svc.isActive = active
        return serviceRepository.save(svc)
    }

    // ── Resources ────────────────────────────────────────────────────────────
    fun listResources(merchantId: UUID): List<ResourceEntity> =
        resourceRepository.findByMerchantIdAndIsActiveTrue(merchantId)

    @Transactional
    fun createResource(merchantId: UUID, authRef: String, name: String): ResourceEntity {
        val merchant = merchantService.getById(merchantId)
        merchantService.requireOwnerOrAdmin(merchant, authRef)
        return resourceRepository.save(ResourceEntity(merchantId = merchantId, name = name))
    }
}
