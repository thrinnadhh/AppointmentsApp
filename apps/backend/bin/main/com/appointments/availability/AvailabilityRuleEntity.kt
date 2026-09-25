package com.appointments.availability

import jakarta.persistence.*
import java.time.LocalTime
import java.util.UUID

@Entity
@Table(name = "availability_rules")
class AvailabilityRuleEntity(
    @Id
    val id: UUID = UUID.randomUUID(),

    @Column(name = "merchant_id", nullable = false)
    val merchantId: UUID,

    @Column(name = "resource_id")
    val resourceId: UUID? = null,

    @Column(name = "day_of_week", nullable = false)
    val dayOfWeek: Int,          // 0=Sun … 6=Sat

    @Column(name = "open_time", nullable = false)
    val openTime: LocalTime,

    @Column(name = "close_time", nullable = false)
    val closeTime: LocalTime,

    @Column(name = "is_closed", nullable = false)
    var isClosed: Boolean = false,
)
