package com.appointments.bookings

import jakarta.persistence.*
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "bookings")
class BookingEntity(
    @Id
    val id: UUID = UUID.randomUUID(),

    @Column(name = "merchant_id", nullable = false)
    val merchantId: UUID,

    @Column(name = "customer_id", nullable = false)
    val customerId: UUID,

    @Column(name = "service_id", nullable = false)
    val serviceId: UUID,

    @Column(name = "resource_id")
    val resourceId: UUID? = null,

    @Column(name = "slot_start", nullable = false)
    val slotStart: Instant,

    @Column(name = "slot_end", nullable = false)
    val slotEnd: Instant,

    @Column(nullable = false)
    var status: String = "CONFIRMED",

    @Column(name = "deposit_amount", nullable = false)
    val depositAmount: BigDecimal = BigDecimal.ZERO,

    @Column(name = "platform_fee", nullable = false)
    val platformFee: BigDecimal = BigDecimal.ZERO,

    @Column(name = "gateway_payment_id")
    val gatewayPaymentId: String? = null,

    @Column(name = "cancelled_by")
    var cancelledBy: UUID? = null,

    @Column(name = "cancelled_at")
    var cancelledAt: Instant? = null,

    @Column
    val notes: String? = null,

    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now(),
)
