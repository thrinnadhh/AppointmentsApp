package com.appointments

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableScheduling

@SpringBootApplication
@EnableScheduling
class AppointmentsApplication

fun main(args: Array<String>) {
    runApplication<AppointmentsApplication>(*args)
}
