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

import com.appointments.identity.UserService
import com.appointments.merchants.MerchantRepository
import com.appointments.merchants.MerchantStaffRepository
import com.appointments.common.errors.ForbiddenException

@RestController
@RequestMapping("/api/v1/bookings", "/bookings")
class BookingController(
    private val bookingService: BookingService,
    private val userService: UserService,
    private val staffRepository: MerchantStaffRepository,
    private val merchantRepository: MerchantRepository,
) {

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

    /** Merchant — list bookings for their shop (strictly tenant-authorized) */
    @GetMapping("/merchant/{merchantId}")
    @PreAuthorize("hasRole('ADMIN') or @securityService.isMerchantStaff(authentication, #merchantId)")
    fun merchantBookings(
        @PathVariable merchantId: UUID,
        @RequestParam(defaultValue = "CONFIRMED") status: String,
    ) = bookingService.listForMerchant(merchantId, status).map { it.toDto() }

    /** Merchant — list bookings for caller's own merchant */
    @GetMapping("/merchant")
    @PreAuthorize("hasAnyRole('MERCHANT_STAFF', 'MERCHANT', 'ADMIN')")
    fun myMerchantBookings(
        @AuthenticationPrincipal principal: AppPrincipal,
        @RequestParam(defaultValue = "CONFIRMED") status: String,
    ): List<BookingDto> {
        val user = userService.requireByAuthRef(principal.authRef)
        val merchantId = staffRepository.findByUserId(user.id).firstOrNull()?.merchantId
            ?: merchantRepository.findByOwnerId(user.id).firstOrNull()?.id
            ?: throw ForbiddenException("User is not associated with any merchant")
        return bookingService.listForMerchant(merchantId, status).map { it.toDto() }
    }

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
