package com.appointments.bookings

import com.appointments.catalog.ServiceRepository
import com.appointments.common.errors.ConflictException
import com.appointments.common.errors.ForbiddenException
import com.appointments.common.errors.NotFoundException
import com.appointments.identity.UserService
import com.appointments.notifications.OutboxEventRepository
import com.appointments.notifications.OutboxEventEntity
import com.fasterxml.jackson.databind.ObjectMapper
import org.slf4j.LoggerFactory
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

@Service
class BookingService(
    private val bookingRepository: BookingRepository,
    private val serviceRepository: ServiceRepository,
    private val userService: UserService,
    private val outboxRepository: OutboxEventRepository,
    private val objectMapper: ObjectMapper,
) {
    private val log = LoggerFactory.getLogger(BookingService::class.java)

    @Transactional
    fun create(
        authRef: String,
        merchantId: UUID,
        serviceId: UUID,
        resourceId: UUID?,
        slotStart: Instant,
    ): BookingEntity {
        val customer = userService.requireByAuthRef(authRef)
        val svc = serviceRepository.findById(serviceId)
            .orElseThrow { NotFoundException("Service not found: $serviceId") }
        val slotEnd = slotStart.plusSeconds(svc.durationMin * 60L)

        val booking = BookingEntity(
            merchantId    = merchantId,
            customerId    = customer.id,
            serviceId     = serviceId,
            resourceId    = resourceId,
            slotStart     = slotStart,
            slotEnd       = slotEnd,
            depositAmount = svc.depositAmt,
        )

        // DataIntegrityViolationException from the exclusion constraint is caught by GlobalExceptionHandler → 409
        val saved = bookingRepository.save(booking)

        // Write outbox event in same transaction
        outboxRepository.save(
            OutboxEventEntity(
                aggregateId = saved.id,
                eventType   = "booking.confirmed",
                payload     = objectMapper.writeValueAsString(
                    mapOf("bookingId" to saved.id, "customerId" to customer.id, "slotStart" to slotStart)
                ),
            )
        )

        log.info("Booking created: id={} merchant={} slot={}", saved.id, merchantId, slotStart)
        return saved
    }

    @Transactional
    fun cancel(bookingId: UUID, authRef: String): BookingEntity {
        val booking = getById(bookingId)
        val user = userService.requireByAuthRef(authRef)

        val isCustomer = booking.customerId == user.id
        val isAdmin    = user.role == "admin"
        if (!isCustomer && !isAdmin) throw ForbiddenException("Cannot cancel this booking")
        if (booking.status == "CANCELLED") throw ConflictException("Booking is already cancelled")
        if (booking.status == "COMPLETED") throw ConflictException("Cannot cancel a completed booking")

        booking.status      = "CANCELLED"
        booking.cancelledBy  = user.id
        booking.cancelledAt  = Instant.now()
        val saved = bookingRepository.save(booking)

        outboxRepository.save(
            OutboxEventEntity(
                aggregateId = saved.id,
                eventType   = "booking.cancelled",
                payload     = objectMapper.writeValueAsString(mapOf("bookingId" to saved.id)),
            )
        )
        return saved
    }

    @Transactional
    fun complete(bookingId: UUID, authRef: String): BookingEntity {
        val booking = getById(bookingId)
        val user = userService.requireByAuthRef(authRef)
        if (user.role != "admin" && user.role != "merchant_staff")
            throw ForbiddenException("Only merchant staff can mark complete")
        booking.status = "COMPLETED"
        return bookingRepository.save(booking)
    }

    fun listForCustomer(authRef: String): List<BookingEntity> {
        val customer = userService.requireByAuthRef(authRef)
        return bookingRepository.findByCustomerIdOrderBySlotStartDesc(customer.id)
    }

    fun listForMerchant(merchantId: UUID, status: String = "CONFIRMED"): List<BookingEntity> =
        bookingRepository.findByMerchantIdAndStatusOrderBySlotStartAsc(merchantId, status)

    fun getById(id: UUID): BookingEntity =
        bookingRepository.findById(id).orElseThrow { NotFoundException("Booking not found: $id") }
}
