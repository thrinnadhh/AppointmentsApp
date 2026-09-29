package com.appointments.bookings

import com.appointments.availability.AvailabilityRuleEntity
import com.appointments.availability.AvailabilityRuleRepository
import org.junit.jupiter.api.Assertions.assertEquals
import com.appointments.catalog.ServiceEntity
import com.appointments.catalog.ServiceRepository
import com.appointments.identity.UserEntity
import com.appointments.identity.UserRepository
import com.appointments.merchants.MerchantEntity
import com.appointments.merchants.MerchantRepository
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.PostgreSQLContainer
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalTime
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger


@SpringBootTest
@Testcontainers
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class DoubleBookingTest {

    companion object {
        @JvmField
        @Container
        val postgres = PostgreSQLContainer<Nothing>("postgres:16-alpine").apply {
            withDatabaseName("appointments_test")
            withUsername("postgres")
            withPassword("postgres")
        }

        @JvmStatic
        @DynamicPropertySource
        fun props(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url", postgres::getJdbcUrl)
            registry.add("spring.datasource.username", postgres::getUsername)
            registry.add("spring.datasource.password", postgres::getPassword)
        }
    }

    @Autowired lateinit var bookingService: BookingService
    @Autowired lateinit var userRepository: UserRepository
    @Autowired lateinit var merchantRepository: MerchantRepository
    @Autowired lateinit var serviceRepository: ServiceRepository
    @Autowired lateinit var availabilityRuleRepository: AvailabilityRuleRepository

    private lateinit var merchantId: UUID
    private lateinit var serviceId: UUID
    private val slot = Instant.parse("2030-01-15T09:00:00Z")  // Fixed future slot

    @BeforeEach
    fun setup() {
        val cityId     = UUID.randomUUID()
        val categoryId = UUID.randomUUID()

        val owner = userRepository.save(UserEntity(authRef = "owner-${UUID.randomUUID()}", role = "merchant_staff"))
        val merchant = merchantRepository.save(
            MerchantEntity(cityId = cityId, ownerId = owner.id, categoryId = categoryId, name = "Test Salon", status = "ACTIVE")
        )
        merchantId = merchant.id

        val svc = serviceRepository.save(
            ServiceEntity(merchantId = merchantId, name = "Haircut", durationMin = 60, depositAmt = BigDecimal("100"))
        )
        serviceId = svc.id

        availabilityRuleRepository.save(
            AvailabilityRuleEntity(
                merchantId  = merchantId,
                dayOfWeek   = 3,  // Wednesday
                openTime    = LocalTime.of(9, 0),
                closeTime   = LocalTime.of(18, 0),
            )
        )
    }

    /**
     * CRITICAL: Fire 20 concurrent booking requests for the same slot.
     * Exactly 1 must succeed; the remaining 19 must be rejected (409 / exception).
     */
    @Test
    fun `concurrent bookings for same slot — exactly one wins`() {
        val concurrency = 20
        val latch       = CountDownLatch(1)
        val executor    = Executors.newFixedThreadPool(concurrency)
        val successes   = AtomicInteger(0)
        val conflicts   = AtomicInteger(0)

        val futures = (1..concurrency).map { i ->
            executor.submit {
                val customer = userRepository.save(UserEntity(authRef = "customer-$i-${UUID.randomUUID()}", role = "customer"))
                latch.await()   // All threads wait here, then fire simultaneously
                try {
                    bookingService.create(
                        authRef    = customer.authRef,
                        merchantId = merchantId,
                        serviceId  = serviceId,
                        resourceId = null,
                        slotStart  = slot,
                    )
                    successes.incrementAndGet()
                } catch (ex: Exception) {
                    conflicts.incrementAndGet()
                }
            }
        }

        latch.countDown()  // Release all threads simultaneously
        futures.forEach { it.get() }
        executor.shutdown()

        assertEquals(1, successes.get(), "Exactly one booking must succeed")
        assertEquals(concurrency - 1, conflicts.get(), "All other requests must conflict")
    }
}
