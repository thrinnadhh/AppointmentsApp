package com.appointments.merchants

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "merchant_staff")
class MerchantStaffEntity(
    @Id
    val id: UUID = UUID.randomUUID(),

    @Column(name = "merchant_id", nullable = false)
    val merchantId: UUID,

    @Column(name = "user_id", nullable = false)
    val userId: UUID,

    @Column(nullable = false)
    val role: String = "staff",

    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now(),
)
