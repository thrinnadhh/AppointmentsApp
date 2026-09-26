package com.appointments.bookings

import com.appointments.common.security.AppPrincipal
import jakarta.validation.Valid
import jakarta.validation.constraints.NotNull
import org.springframework.http.HttpStatus
import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

@RestController
@RequestMapping("/api/v1/bookings")
class BookingController(private val bookingService: BookingService) {

    /** Customer — create a new booking */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("isAuthenticated()")
    fun create(
        @AuthenticationPrincipal principal: AppPrincipal,
        @Valid @RequestBody req: CreateBookingRequest,
    ) = bookingService.create(
        authRef    = principal.authRef,
        merchantId = req.merchantId,
        serviceId  = req.serviceId,
        resourceId = req.resourceId,
        slotStart  = req.slotStart,
    ).toDto()

    /** Customer — own bookings */
    @GetMapping("/my")
    @PreAuthorize("isAuthenticated()")
    fun myBookings(@AuthenticationPrincipal principal: AppPrincipal) =
        bookingService.listForCustomer(principal.authRef).map { it.toDto() }

    /** Merchant — list bookings for their shop */
    @GetMapping("/merchant/{merchantId}")
    @PreAuthorize("isAuthenticated()")
    fun merchantBookings(
        @PathVariable merchantId: UUID,
        @RequestParam(defaultValue = "CONFIRMED") status: String,
    ) = bookingService.listForMerchant(merchantId, status).map { it.toDto() }

    /** Customer or admin — cancel */
    @PostMapping("/{id}/cancel")
    @PreAuthorize("isAuthenticated()")
    fun cancel(
        @PathVariable id: UUID,
        @AuthenticationPrincipal principal: AppPrincipal,
    ) = bookingService.cancel(id, principal.authRef).toDto()

    /** Merchant staff — mark complete */
    @PostMapping("/{id}/complete")
    @PreAuthorize("hasAnyRole('MERCHANT_STAFF', 'ADMIN')")
    fun complete(
        @PathVariable id: UUID,
        @AuthenticationPrincipal principal: AppPrincipal,
    ) = bookingService.complete(id, principal.authRef).toDto()
}

data class CreateBookingRequest(
    @field:NotNull val merchantId: UUID,
    @field:NotNull val serviceId: UUID,
    val resourceId: UUID? = null,
    @field:NotNull val slotStart: Instant,
)

data class BookingDto(
    val id: UUID,
    val merchantId: UUID,
    val customerId: UUID,
    val serviceId: UUID,
    val resourceId: UUID?,
    val slotStart: Instant,
    val slotEnd: Instant,
    val status: String,
    val depositAmount: BigDecimal,
)

fun BookingEntity.toDto() = BookingDto(
    id = id, merchantId = merchantId, customerId = customerId,
    serviceId = serviceId, resourceId = resourceId,
    slotStart = slotStart, slotEnd = slotEnd, status = status,
    depositAmount = depositAmount,
)
