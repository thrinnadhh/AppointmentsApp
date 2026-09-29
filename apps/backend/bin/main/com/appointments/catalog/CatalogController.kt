package com.appointments.catalog

import com.appointments.common.security.AppPrincipal
import jakarta.validation.Valid
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import org.springframework.http.HttpStatus
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*
import java.math.BigDecimal
import java.util.UUID

@RestController
@RequestMapping("/api/v1")
class CatalogController(private val catalogService: CatalogService) {

    @GetMapping("/categories")
    fun categories() = catalogService.listCategories().map {
        mapOf("id" to it.id, "slug" to it.slug, "name" to it.name, "iconKey" to it.iconKey)
    }

    @GetMapping("/merchants/{merchantId}/services")
    fun services(@PathVariable merchantId: UUID) =
        catalogService.listServices(merchantId).map { it.toDto() }

    @PostMapping("/merchants/{merchantId}/services")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    fun createService(
        @PathVariable merchantId: UUID,
        @AuthenticationPrincipal principal: AppPrincipal,
        @Valid @RequestBody req: CreateServiceRequest,
    ) = catalogService.createService(merchantId, principal.authRef, req.name, req.durationMin, req.depositAmt).toDto()

    @PatchMapping("/merchants/{merchantId}/services/{id}/toggle")
    @PreAuthorize("isAuthenticated()")
    fun toggleService(
        @PathVariable merchantId: UUID,
        @PathVariable id: UUID,
        @AuthenticationPrincipal principal: AppPrincipal,
        @RequestParam active: Boolean,
    ) = catalogService.toggleService(id, merchantId, principal.authRef, active).toDto()

    @GetMapping("/merchants/{merchantId}/resources")
    fun resources(@PathVariable merchantId: UUID) =
        catalogService.listResources(merchantId).map { mapOf("id" to it.id, "name" to it.name) }

    @PostMapping("/merchants/{merchantId}/resources")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    fun createResource(
        @PathVariable merchantId: UUID,
        @AuthenticationPrincipal principal: AppPrincipal,
        @Valid @RequestBody req: CreateResourceRequest,
    ) = catalogService.createResource(merchantId, principal.authRef, req.name).let {
        mapOf("id" to it.id, "name" to it.name)
    }
}

data class CreateServiceRequest(
    @field:NotBlank val name: String,
    @field:Min(5) val durationMin: Int,
    val depositAmt: BigDecimal = BigDecimal.ZERO,
)
data class CreateResourceRequest(@field:NotBlank val name: String)

data class ServiceDto(
    val id: UUID, val merchantId: UUID, val name: String,
    val durationMin: Int, val depositAmt: BigDecimal, val isActive: Boolean,
)
fun ServiceEntity.toDto() = ServiceDto(id, merchantId, name, durationMin, depositAmt, isActive)
