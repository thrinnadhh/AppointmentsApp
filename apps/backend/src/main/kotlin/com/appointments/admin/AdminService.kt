package com.appointments.admin

import com.appointments.common.errors.NotFoundException
import com.appointments.merchants.MerchantEntity
import com.appointments.merchants.MerchantRepository
import com.appointments.notifications.OutboxEventEntity
import com.appointments.notifications.OutboxEventRepository
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

@Service
class AdminService(
    private val merchantRepository: MerchantRepository,
    private val outboxRepository: OutboxEventRepository,
    private val objectMapper: ObjectMapper,
) {
    fun pendingMerchants(): List<MerchantEntity> = merchantRepository.findPending()

    @Transactional
    fun approveMerchant(merchantId: UUID): MerchantEntity {
        val merchant = merchantRepository.findById(merchantId)
            .orElseThrow { NotFoundException("Merchant not found: $merchantId") }
        merchant.status = "ACTIVE"
        val saved = merchantRepository.save(merchant)
        outboxRepository.save(
            OutboxEventEntity(
                aggregateId = merchant.id,
                eventType   = "merchant.approved",
                payload     = objectMapper.writeValueAsString(mapOf("merchantId" to merchant.id, "ownerId" to merchant.ownerId)),
            )
        )
        return saved
    }

    @Transactional
    fun suspendMerchant(merchantId: UUID): MerchantEntity {
        val merchant = merchantRepository.findById(merchantId)
            .orElseThrow { NotFoundException("Merchant not found: $merchantId") }
        merchant.status = "SUSPENDED"
        return merchantRepository.save(merchant)
    }
}
