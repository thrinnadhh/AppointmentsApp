package com.appointments.bookings

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param
import java.time.Instant
import java.util.UUID

interface BookingRepository : JpaRepository<BookingEntity, UUID> {

    fun findByCustomerIdOrderBySlotStartDesc(customerId: UUID): List<BookingEntity>

    fun findByMerchantIdAndStatusOrderBySlotStartAsc(merchantId: UUID, status: String): List<BookingEntity>

    @Query(
        """
        SELECT b FROM BookingEntity b
        WHERE b.merchantId = :merchantId
          AND b.resourceId = :resourceId
          AND b.status != 'CANCELLED'
          AND b.slotStart < :windowEnd
          AND b.slotEnd   > :windowStart
        """
    )
    fun findConfirmedOverlapping(
        @Param("merchantId") merchantId: UUID,
        @Param("resourceId") resourceId: UUID,
        @Param("windowStart") windowStart: Instant,
        @Param("windowEnd") windowEnd: Instant,
    ): List<BookingEntity>

    @Query(
        """
        SELECT b FROM BookingEntity b
        WHERE b.merchantId  = :merchantId
          AND b.resourceId IS NULL
          AND b.status != 'CANCELLED'
          AND b.slotStart < :windowEnd
          AND b.slotEnd   > :windowStart
        """
    )
    fun findConfirmedOverlappingNoResource(
        @Param("merchantId") merchantId: UUID,
        @Param("windowStart") windowStart: Instant,
        @Param("windowEnd") windowEnd: Instant,
    ): List<BookingEntity>

    /** Upcoming bookings needing a reminder notification */
    @Query(
        """
        SELECT b FROM BookingEntity b
        WHERE b.status = 'CONFIRMED'
          AND b.slotStart >= :from
          AND b.slotStart <  :until
        """
    )
    fun findUpcomingForReminder(
        @Param("from") from: Instant,
        @Param("until") until: Instant,
    ): List<BookingEntity>
}
