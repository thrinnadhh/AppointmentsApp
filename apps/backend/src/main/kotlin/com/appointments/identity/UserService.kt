package com.appointments.identity

import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * Handles user provisioning from Supabase auth webhook.
 * Called once per user on first sign-up; idempotent.
 */
@Service
class UserService(private val userRepository: UserRepository) {

    private val log = LoggerFactory.getLogger(UserService::class.java)

    @Transactional
    fun provisionUser(authRef: String, email: String?, phone: String?): UserEntity {
        val safeAuthRef = authRef.replace("\r", "").replace("\n", "")
        if (userRepository.existsByAuthRef(authRef)) {
            log.debug("User already provisioned: authRef={}", safeAuthRef)
            return userRepository.findByAuthRef(authRef)!!
        }
        val user = UserEntity(
            authRef = authRef,
            email = email,
            phone = phone,
            role = "customer",
        )
        return userRepository.save(user).also {
            log.info("Provisioned new user: id={}, authRef={}", it.id, safeAuthRef)
        }
    }

    fun findByAuthRef(authRef: String): UserEntity? = userRepository.findByAuthRef(authRef)

    fun requireByAuthRef(authRef: String): UserEntity =
        findByAuthRef(authRef)
            ?: throw com.appointments.common.errors.NotFoundException("User not found: $authRef")
}
