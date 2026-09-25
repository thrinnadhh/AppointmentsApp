package com.appointments.merchants

import com.appointments.common.security.AppPrincipal
import jakarta.validation.Valid
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*
import java.util.UUID

@RestController
@RequestMapping("/api/v1/merchants")
class MerchantController(private val merchantService: MerchantService) {

    /** Public — any visitor can browse active merchants in a city */
    @GetMapping
    fun list(
        @RequestParam cityId: UUID,
        @RequestParam(required = false) categoryId: UUID?,
    ) = merchantService.listByCity(cityId, categoryId).map { it.toDto() }

    /** Public — merchant detail page */
    @GetMapping("/{id}")
    fun get(@PathVariable id: UUID) = merchantService.getById(id).toDto()

    /** Authenticated — merchant owner registers */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAnyRole('MERCHANT_STAFF', 'ADMIN')")
    fun register(
        @AuthenticationPrincipal principal: AppPrincipal,
        @Valid @RequestBody req: RegisterMerchantRequest,
    ) = merchantService.register(
        authRef    = principal.authRef,
        cityId     = req.cityId,
        categoryId = req.categoryId,
        name       = req.name,
        address    = req.address,
        lat        = req.lat,
        lng        = req.lng,
        photoUrl   = req.photoUrl,
    ).toDto()

    /** Merchant staff — update own profile */
    @PatchMapping("/{id}")
    @PreAuthorize("isAuthenticated()")
    fun update(
        @PathVariable id: UUID,
        @AuthenticationPrincipal principal: AppPrincipal,
        @RequestBody req: UpdateMerchantRequest,
    ) = merchantService.updateProfile(
        merchantId = id,
        authRef    = principal.authRef,
        name       = req.name,
        address    = req.address,
        lat        = req.lat,
        lng        = req.lng,
        photoUrl   = req.photoUrl,
    ).toDto()
}

data class RegisterMerchantRequest(
    val cityId: UUID,
    val categoryId: UUID,
    @field:NotBlank val name: String,
    val address: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val photoUrl: String? = null,
)

data class UpdateMerchantRequest(
    val name: String? = null,
    val address: String? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val photoUrl: String? = null,
)

data class MerchantDto(
    val id: UUID,
    val cityId: UUID,
    val categoryId: UUID,
    val name: String,
    val address: String?,
    val lat: Double?,
    val lng: Double?,
    val photoUrl: String?,
    val status: String,
)

fun MerchantEntity.toDto() = MerchantDto(
    id = id, cityId = cityId, categoryId = categoryId,
    name = name, address = address, lat = lat, lng = lng,
    photoUrl = photoUrl, status = status,
)
