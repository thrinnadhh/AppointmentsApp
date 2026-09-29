package com.appointments.admin

import org.springframework.security.access.prepost.PreAuthorize
import org.springframework.web.bind.annotation.*
import java.util.UUID

@RestController
@RequestMapping("/api/v1/admin")
@PreAuthorize("hasRole('ADMIN')")   // All admin endpoints gate-locked
class AdminController(private val adminService: AdminService) {

    @GetMapping("/merchants/pending")
    fun pendingMerchants() = adminService.pendingMerchants().map {
        mapOf(
            "id" to it.id, "name" to it.name, "cityId" to it.cityId,
            "categoryId" to it.categoryId, "status" to it.status, "createdAt" to it.createdAt,
        )
    }

    @PostMapping("/merchants/{id}/approve")
    fun approve(@PathVariable id: UUID) = adminService.approveMerchant(id).let {
        mapOf("id" to it.id, "status" to it.status)
    }

    @PostMapping("/merchants/{id}/suspend")
    fun suspend(@PathVariable id: UUID) = adminService.suspendMerchant(id).let {
        mapOf("id" to it.id, "status" to it.status)
    }
}
