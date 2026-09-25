package com.appointments.identity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "users")
class UserEntity(
    @Id
    val id: UUID = UUID.randomUUID(),

    @Column(name = "auth_ref", unique = true, nullable = false)
    val authRef: String,

    @Column
    val email: String? = null,

    @Column(unique = true)
    val phone: String? = null,

    @Column(nullable = false)
    val role: String = "customer",

    @Column(name = "city_id")
    val cityId: UUID? = null,

    @Column(name = "created_at", nullable = false, updatable = false)
    val createdAt: Instant = Instant.now(),
)
