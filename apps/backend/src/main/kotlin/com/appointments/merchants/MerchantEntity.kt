package com.appointments.merchants

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "merchants")
class MerchantEntity(
    @Id
    val id: UUID = UUID.randomUUID(),

    @Column(name = "city_id", nullable = false)
    val cityId: UUID,

    @Column(name = "owner_id", nullable = false)
    val ownerId: UUID,

    @Column(name = "category_id", nullable = false)
    val categoryId: UUID,

    @Column(nullable = false)
    var name: String,

    @Column
    var address: String? = null,

    @Column(precision = 9, scale = 6)
    var lat: Double? = null,

    @Column(precision = 9, scale = 6)
    var lng: Double? = null,

    @Column(name = "photo_url")
    var photoUrl: String? = null,

    @Column(nullable = false)
    var status: String = "PENDING",

    @Column(nullable = false)
    val timezone: String = "Asia/Kolkata",

    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now(),
)
