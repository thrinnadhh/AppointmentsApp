package com.appointments.notifications

import com.fasterxml.jackson.databind.ObjectMapper
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.annotation.Transactional
import java.time.Instant

/**
 * Polls the outbox_events table for unprocessed events and dispatches them to Novu.
 * ShedLock ensures only one instance runs at a time (safe for future horizontal scale).
 */
@Component
class OutboxPoller(
    private val outboxRepository: OutboxEventRepository,
    private val novuClient: NovuClient,
    private val objectMapper: ObjectMapper,
) {
    private val log = LoggerFactory.getLogger(OutboxPoller::class.java)

    /** Map outbox event types to Novu workflow IDs */
    private val workflowMap = mapOf(
        "booking.confirmed"  to "booking-confirmed",
        "booking.cancelled"  to "booking-cancelled",
        "booking.reminder"   to "booking-reminder",
        "merchant.approved"  to "merchant-approved",
    )

    @Scheduled(fixedDelayString = "\${app.outbox.poll-interval-ms:30000}")
    @SchedulerLock(name = "outboxPoller", lockAtMostFor = "PT2M", lockAtLeastFor = "PT25S")
    @Transactional
    fun poll() {
        val events = outboxRepository.findUnprocessed()
        if (events.isEmpty()) return
        log.debug("Processing {} outbox events", events.size)

        events.forEach { event ->
            try {
                val payload = objectMapper.readValue(event.payload, Map::class.java)
                @Suppress("UNCHECKED_CAST")
                val typedPayload = payload as Map<String, Any>
                val workflowId  = workflowMap[event.eventType] ?: run {
                    log.warn("Unknown event type: {}", event.eventType)
                    return@forEach
                }
                val subscriberId = typedPayload["customerId"]?.toString() ?: return@forEach
                novuClient.trigger(workflowId, subscriberId, typedPayload)
                event.processedAt = Instant.now()
                outboxRepository.save(event)
            } catch (ex: Exception) {
                log.error("Failed to process outbox event id={}: {}", event.id, ex.message)
                // Leave processedAt=null so it retries next poll cycle
            }
        }
    }
}
