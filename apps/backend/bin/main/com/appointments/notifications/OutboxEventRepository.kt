package com.appointments.notifications

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import java.util.UUID

interface OutboxEventRepository : JpaRepository<OutboxEventEntity, UUID> {
    @Query("SELECT e FROM OutboxEventEntity e WHERE e.processedAt IS NULL ORDER BY e.createdAt ASC")
    fun findUnprocessed(): List<OutboxEventEntity>
}
