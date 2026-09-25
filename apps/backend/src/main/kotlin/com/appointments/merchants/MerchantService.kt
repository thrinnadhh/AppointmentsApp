package com.appointments.merchants

import com.appointments.common.errors.ForbiddenException
import com.appointments.common.errors.NotFoundException
import com.appointments.identity.UserService
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

@Service
class MerchantService(
    private val merchantRepository: MerchantRepository,
    private val staffRepository: MerchantStaffRepository,
    private val userService: UserService,
) {

    fun listByCity(cityId: UUID, categoryId: UUID?): List<MerchantEntity> =
        if (categoryId != null)
            merchantRepository.findByCityIdAndCategoryIdAndStatus(cityId, categoryId, "ACTIVE")
        else
            merchantRepository.findByCityIdAndStatus(cityId, "ACTIVE")

    fun getById(id: UUID): MerchantEntity =
        merchantRepository.findById(id).orElseThrow { NotFoundException("Merchant not found: $id") }

    @Transactional
    fun register(
        authRef: String,
        cityId: UUID,
        categoryId: UUID,
        name: String,
        address: String?,
        lat: Double?,
        lng: Double?,
        photoUrl: String?,
    ): MerchantEntity {
        val owner = userService.requireByAuthRef(authRef)
        val merchant = MerchantEntity(
            cityId = cityId,
            ownerId = owner.id,
            categoryId = categoryId,
            name = name,
            address = address,
            lat = lat,
            lng = lng,
            photoUrl = photoUrl,
        )
        val saved = merchantRepository.save(merchant)
        // Add owner as staff with owner role
        staffRepository.save(
            MerchantStaffEntity(
                merchantId = saved.id,
                userId = owner.id,
                role = "owner",
            )
        )
        return saved
    }

    @Transactional
    fun updateProfile(
        merchantId: UUID,
        authRef: String,
        name: String?,
        address: String?,
        lat: Double?,
        lng: Double?,
        photoUrl: String?,
    ): MerchantEntity {
        val merchant = getById(merchantId)
        requireOwnerOrAdmin(merchant, authRef)
        name?.let { merchant.name = it }
        address?.let { merchant.address = it }
        lat?.let { merchant.lat = it }
        lng?.let { merchant.lng = it }
        photoUrl?.let { merchant.photoUrl = it }
        return merchantRepository.save(merchant)
    }

    fun requireOwnerOrAdmin(merchant: MerchantEntity, authRef: String) {
        val user = userService.requireByAuthRef(authRef)
        if (user.role == "admin") return
        val isStaff = staffRepository.existsByMerchantIdAndUserId(merchant.id, user.id)
        if (!isStaff) throw ForbiddenException("Not a member of this merchant")
    }
}
