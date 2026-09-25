package com.appointments.identity

import org.springframework.data.jpa.repository.JpaRepository
import java.util.UUID

interface UserRepository : JpaRepository<UserEntity, UUID> {
    fun findByAuthRef(authRef: String): UserEntity?
    fun existsByAuthRef(authRef: String): Boolean
}
