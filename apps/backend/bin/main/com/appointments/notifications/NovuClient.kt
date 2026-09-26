package com.appointments.notifications

import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.web.reactive.function.client.WebClient
import org.springframework.web.reactive.function.client.bodyToMono

/**
 * Minimal Novu API client.
 * Only sends trigger events — workflow logic lives in the Novu dashboard.
 */
@Component
class NovuClient(
    @Value("\${app.novu.api-key}") private val apiKey: String,
    @Value("\${app.novu.base-url}") private val baseUrl: String,
) {
    private val log = LoggerFactory.getLogger(NovuClient::class.java)

    private val webClient by lazy {
        WebClient.builder()
            .baseUrl(baseUrl)
            .defaultHeader("Authorization", "ApiKey $apiKey")
            .defaultHeader("Content-Type", "application/json")
            .build()
    }

    /**
     * Fires a Novu workflow trigger.
     * @param workflowId  Workflow identifier in Novu dashboard (e.g. "booking-confirmed")
     * @param subscriberId  Novu subscriber ID (we use our internal user UUID as string)
     * @param payload  Event payload passed to Novu templates
     */
    fun trigger(workflowId: String, subscriberId: String, payload: Map<String, Any>) {
        if (apiKey.isBlank()) {
            log.warn("Novu API key not configured — skipping notification for workflow={}", workflowId)
            return
        }
        val body = mapOf(
            "name"   to workflowId,
            "to"     to mapOf("subscriberId" to subscriberId),
            "payload" to payload,
        )
        webClient.post()
            .uri("/v1/events/trigger")
            .bodyValue(body)
            .retrieve()
            .bodyToMono<String>()
            .subscribe(
                { log.debug("Novu trigger ok: workflow={}", workflowId) },
                { log.error("Novu trigger failed: workflow={} error={}", workflowId, it.message) },
            )
    }
}
