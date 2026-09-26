package com.appointments.common.errors

import jakarta.validation.ConstraintViolationException
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.http.ProblemDetail
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import java.time.Instant

@RestControllerAdvice
class GlobalExceptionHandler {

    @ExceptionHandler(NotFoundException::class)
    fun handleNotFound(ex: NotFoundException): ProblemDetail =
        problem(HttpStatus.NOT_FOUND, ex.message ?: "Not found")

    @ExceptionHandler(ForbiddenException::class)
    fun handleForbidden(ex: ForbiddenException): ProblemDetail =
        problem(HttpStatus.FORBIDDEN, ex.message ?: "Forbidden")

    @ExceptionHandler(ConflictException::class)
    fun handleConflict(ex: ConflictException): ProblemDetail =
        problem(HttpStatus.CONFLICT, ex.message ?: "Conflict")

    /** Catches the DB exclusion constraint violation and returns a clean 409 */
    @ExceptionHandler(DataIntegrityViolationException::class)
    fun handleDbConflict(ex: DataIntegrityViolationException): ProblemDetail {
        val msg = if (ex.message?.contains("exclude", ignoreCase = true) == true)
            "This time slot is no longer available"
        else
            "A data conflict occurred"
        return problem(HttpStatus.CONFLICT, msg)
    }

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun handleValidation(ex: MethodArgumentNotValidException): ProblemDetail {
        val errors = ex.bindingResult.fieldErrors.map { "${it.field}: ${it.defaultMessage}" }
        val detail = problem(HttpStatus.BAD_REQUEST, "Validation failed")
        detail.setProperty("errors", errors)
        return detail
    }

    @ExceptionHandler(ConstraintViolationException::class)
    fun handleConstraint(ex: ConstraintViolationException): ProblemDetail =
        problem(HttpStatus.BAD_REQUEST, ex.message ?: "Constraint violation")

    private fun problem(status: HttpStatus, detail: String): ProblemDetail =
        ProblemDetail.forStatus(status).also {
            it.detail = detail
            it.setProperty("timestamp", Instant.now())
        }
}

class NotFoundException(message: String) : RuntimeException(message)
class ForbiddenException(message: String) : RuntimeException(message)
class ConflictException(message: String) : RuntimeException(message)
