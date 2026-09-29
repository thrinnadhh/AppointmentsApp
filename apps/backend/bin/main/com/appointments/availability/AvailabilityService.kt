package com.appointments.availability

import com.appointments.bookings.BookingRepository
import org.springframework.stereotype.Service
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.UUID

data class SlotDto(
    val start: Instant,
    val end: Instant,
    val available: Boolean,
)

@Service
class AvailabilityService(
    private val ruleRepository: AvailabilityRuleRepository,
    private val bookingRepository: BookingRepository,
) {

    /**
     * Generates all theoretically-available slots for a merchant on a given date,
     * then marks each slot as available or not based on confirmed bookings.
     *
     * @param merchantId  The merchant
     * @param resourceId  Optional — if provided, checks resource-specific rules
     * @param serviceMin  Duration of the service in minutes
     * @param date        Local date in the merchant's timezone
     * @param tz          Merchant timezone (e.g. "Asia/Kolkata")
     */
    fun getSlots(
        merchantId: UUID,
        resourceId: UUID?,
        serviceMin: Int,
        date: LocalDate,
        tz: String,
    ): List<SlotDto> {
        val zone = ZoneId.of(tz)
        val dow  = date.dayOfWeek.value % 7   // Java DayOfWeek: MON=1…SUN=7, we need 0=Sun..6=Sat

        val rules = if (resourceId != null)
            ruleRepository.findByMerchantIdAndResourceId(merchantId, resourceId)
        else
            ruleRepository.findByMerchantIdAndResourceIdIsNull(merchantId)

        val rule = rules.find { it.dayOfWeek == dow } ?: return emptyList()
        if (rule.isClosed) return emptyList()

        // Generate candidate slots (step = serviceMin)
        val slots = mutableListOf<SlotDto>()
        var cursor = LocalDateTime.of(date, rule.openTime)
        val end    = LocalDateTime.of(date, rule.closeTime)

        while (!cursor.plusMinutes(serviceMin.toLong()).isAfter(end)) {
            val slotStart = cursor.atZone(zone).toInstant()
            val slotEnd   = cursor.plusMinutes(serviceMin.toLong()).atZone(zone).toInstant()
            slots.add(SlotDto(slotStart, slotEnd, true))
            cursor = cursor.plusMinutes(serviceMin.toLong())
        }

        if (slots.isEmpty()) return emptyList()

        // Check existing bookings in this window
        val windowStart = slots.first().start
        val windowEnd   = slots.last().end
        val booked = if (resourceId != null)
            bookingRepository.findConfirmedOverlapping(merchantId, resourceId, windowStart, windowEnd)
        else
            bookingRepository.findConfirmedOverlappingNoResource(merchantId, windowStart, windowEnd)

        // Mark booked slots
        return slots.map { slot ->
            val isBooked = booked.any { b ->
                b.slotStart.isBefore(slot.end) && b.slotEnd.isAfter(slot.start)
            }
            slot.copy(available = !isBooked)
        }
    }
}
