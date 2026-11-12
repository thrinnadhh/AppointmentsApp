"""
Dynamic Hospital Appointment Scheduling System
===============================================
An event-driven queueing algorithm that handles early, on-time, and late patient arrivals
without rigid fixed time slots, minimizing doctor idle time while preserving promised
appointment ceilings.

Key Invariants:
1. Sliding Time Window: On-time is defined within [promised - 10, promised + 10).
2. Late Queue Sorting: Strictly ordered by original booked/promised time, NOT check-in time.
3. Early Patients: Used to prevent doctor idle time; booked time acts as a ceiling.
4. Fit Check: A late patient can preempt an early patient IF AND ONLY IF their expected
   consultation duration finishes before the next unserved patient's deadline (window opening / promised time).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Tuple, Union


class PriorityReason(str, Enum):
    ON_TIME = "PRIORITY_1_ON_TIME"
    LATE_FIT_CHECK = "PRIORITY_2_LATE_FIT_CHECK"
    EARLY_IDLE_PREVENTION = "PRIORITY_3_EARLY_IDLE_PREVENTION"
    IDLE = "PRIORITY_4_IDLE"


def parse_time(time_val: Union[str, int]) -> int:
    """
    Parses a time representation into continuous integer minutes from midnight.
    Accepts 'H:MM', 'HH:MM', or integer minutes.
    """
    if isinstance(time_val, int):
        return time_val
    if isinstance(time_val, str):
        parts = time_val.strip().split(":")
        if len(parts) == 2:
            h, m = map(int, parts)
            return h * 60 + m
    raise ValueError(f"Invalid time format: {time_val}. Expected 'H:MM', 'HH:MM', or integer minutes.")


def format_time(minutes: Union[int, float, None]) -> str:
    """Converts continuous integer minutes from midnight back to 'H:MM' or '∞'."""
    if minutes is None:
        return "None"
    if minutes == float("inf"):
        return "∞"
    total_mins = int(minutes)
    h = total_mins // 60
    m = total_mins % 60
    return f"{h}:{m:02d}"


@dataclass
class Patient:
    """
    Represents a patient with booking details, arrival timestamp, and consultation metrics.
    """
    name: str
    booked_time_input: Union[str, int]
    arrival_time_input: Union[str, int]
    expected_duration: int = 10  # in minutes
    
    # Internal integer minutes representation
    booked_time: int = field(init=False)
    arrival_time: int = field(init=False)

    # State tracking
    served: bool = field(default=False, init=False)
    started_at: Optional[int] = field(default=None, init=False)
    finished_at: Optional[int] = field(default=None, init=False)
    priority_assigned: Optional[PriorityReason] = field(default=None, init=False)

    def __post_init__(self):
        self.booked_time = parse_time(self.booked_time_input)
        self.arrival_time = parse_time(self.arrival_time_input)

    def window_start(self, window_tolerance: int = 10) -> int:
        """Returns the start of the on-time window (promised - tolerance)."""
        return self.booked_time - window_tolerance

    def window_end(self, window_tolerance: int = 10) -> int:
        """Returns the end of the on-time window (promised + tolerance)."""
        return self.booked_time + window_tolerance

    def is_present(self, now: int) -> bool:
        """Returns True if the patient has checked in and is not yet served."""
        return not self.served and self.arrival_time <= now

    def is_on_time(self, now: int, window_tolerance: int = 10) -> bool:
        """
        True if current time falls within [promised - tolerance, promised + tolerance).
        Using half-open interval ensures clean handoff when a window closes.
        """
        return self.window_start(window_tolerance) <= now < self.window_end(window_tolerance)

    def is_early(self, now: int, window_tolerance: int = 10) -> bool:
        """True if the patient's on-time window has not opened yet."""
        return now < self.window_start(window_tolerance)

    def is_late(self, now: int, window_tolerance: int = 10) -> bool:
        """True if current time is at or beyond the end of the on-time window."""
        return now >= self.window_end(window_tolerance)


@dataclass
class ConsultationRecord:
    patient_name: str
    booked_time: str
    arrival_time: str
    start_time: str
    end_time: str
    duration: int
    priority: PriorityReason
    decision_notes: str


class ClinicQueueManager:
    """
    Manages dynamic hospital appointment queues and executes event-driven routing
    whenever the doctor becomes free.
    """

    def __init__(
        self,
        window_tolerance: int = 10,
        deadline_mode: str = "window_open",
        verbose_logging: bool = True,
    ):
        """
        Args:
            window_tolerance: Window half-width in minutes (default 10 -> 20 min total).
            deadline_mode: 
                - 'window_open': Deadline is the window start of the next early patient (preserves window opening).
                - 'promised_time': Deadline is the promised appointment time of the next patient.
            verbose_logging: Enables formatted decision trace output.
        """
        self.window_tolerance = window_tolerance
        self.deadline_mode = deadline_mode
        self.verbose_logging = verbose_logging
        self.patients: List[Patient] = []
        self.history: List[ConsultationRecord] = []

    def register_patient(self, patient: Patient) -> None:
        """Registers a patient into the clinic registry."""
        self.patients.append(patient)

    def on_doctor_free(self, current_time_input: Union[str, int]) -> Optional[Patient]:
        """
        Core decision trigger: Evaluates the queue and schedules the next patient.
        
        Algorithm Priority:
        1. On-Time Priority: Patient present & in active window (earliest promised time).
        2. Late Queue Fit Check: Late queue head fits before next unserved deadline.
        3. Early Patients: Doctor idle prevention (earliest promised time).
        4. Idle: Doctor waits.
        """
        now = parse_time(current_time_input)
        now_str = format_time(now)

        present = [p for p in self.patients if p.is_present(now)]

        if self.verbose_logging:
            print("\n" + "=" * 70)
            print(f"🔔 [DOCTOR FREE EVENT] at {now_str} (t={now} min)")
            print(f"   Present Patients: {[p.name for p in present]}")

        # Partition present patients into queues
        on_time_patients = [p for p in present if p.is_on_time(now, self.window_tolerance)]
        early_patients = [p for p in present if p.is_early(now, self.window_tolerance)]
        late_patients = [p for p in present if p.is_late(now, self.window_tolerance)]

        # Sorting rules:
        # - On-time: sorted by promised booking time
        # - Late queue: strictly ordered by originally booked/promised time (NOT check-in time)
        # - Early: sorted by promised booking time
        on_time_queue = sorted(on_time_patients, key=lambda p: p.booked_time)
        late_queue = sorted(late_patients, key=lambda p: p.booked_time)
        early_queue = sorted(early_patients, key=lambda p: p.booked_time)

        if self.verbose_logging:
            print("   Current Queues:")
            print(f"     • On-Time Queue : {[(p.name, f'booked:{format_time(p.booked_time)}') for p in on_time_queue]}")
            print(f"     • Late Queue    : {[(p.name, f'booked:{format_time(p.booked_time)}') for p in late_queue]}")
            print(f"     • Early Queue   : {[(p.name, f'booked:{format_time(p.booked_time)}') for p in early_queue]}")

        # -------------------------------------------------------------
        # Step 1: On-Time Priority
        # -------------------------------------------------------------
        if on_time_queue:
            chosen = on_time_queue[0]
            reason = PriorityReason.ON_TIME
            notes = (
                f"On-time window [{format_time(chosen.window_start(self.window_tolerance))} - "
                f"{format_time(chosen.window_end(self.window_tolerance))}) is active. "
                f"Selected earliest booked: {chosen.name}."
            )
            if self.verbose_logging:
                print(f"   👉 [Decision: {reason.value}]")
                print(f"      {notes}")
            self._start_consultation(chosen, now, reason, notes)
            return chosen

        # -------------------------------------------------------------
        # Step 2: Late Queue "Fit Check"
        # -------------------------------------------------------------
        if late_queue:
            head_late = late_queue[0]
            finish_time = now + head_late.expected_duration

            # Find next unserved patient whose window hasn't passed (early present or future booking)
            upcoming = [
                p for p in self.patients
                if not p.served and (p in early_queue or p.booked_time > now)
            ]

            if upcoming:
                if self.deadline_mode == "window_open":
                    next_patient = min(upcoming, key=lambda p: p.window_start(self.window_tolerance))
                    deadline = next_patient.window_start(self.window_tolerance)
                    deadline_desc = f"window opens for {next_patient.name} at {format_time(deadline)}"
                else:
                    next_patient = min(upcoming, key=lambda p: p.booked_time)
                    deadline = next_patient.booked_time
                    deadline_desc = f"promised appointment for {next_patient.name} at {format_time(deadline)}"
            else:
                deadline = float("inf")
                deadline_desc = "no upcoming scheduled patients (deadline = ∞)"

            if self.verbose_logging:
                print(f"   🔍 [Evaluating PRIORITY 2 - LATE QUEUE FIT CHECK]")
                print(f"      Late Head        : {head_late.name} (Booked: {format_time(head_late.booked_time)}, Duration: {head_late.expected_duration} min)")
                print(f"      Est Completion   : {format_time(finish_time)}")
                print(f"      Deadline Ceiling : {format_time(deadline)} ({deadline_desc})")

            # Fit Check Condition
            if finish_time <= deadline:
                reason = PriorityReason.LATE_FIT_CHECK
                notes = (
                    f"Late patient {head_late.name} completion ({format_time(finish_time)}) <= "
                    f"deadline ({format_time(deadline)}). Preempts early queue without causing delay."
                )
                if self.verbose_logging:
                    print(f"   👉 [Decision: {reason.value}]")
                    print(f"      {notes}")
                self._start_consultation(head_late, now, reason, notes)
                return head_late
            else:
                if self.verbose_logging:
                    print(f"   ⛔ [Fit Check Failed]: {head_late.name} finishes at {format_time(finish_time)} > deadline {format_time(deadline)}.")

        # -------------------------------------------------------------
        # Step 3: Early Patients (Doctor Idle Prevention)
        # -------------------------------------------------------------
        if early_queue:
            chosen = early_queue[0]
            reason = PriorityReason.EARLY_IDLE_PREVENTION
            notes = (
                f"Doctor idle prevention: {chosen.name} booked for {format_time(chosen.booked_time)} "
                f"arrived early at {format_time(chosen.arrival_time)}."
            )
            if self.verbose_logging:
                print(f"   👉 [Decision: {reason.value}]")
                print(f"      {notes}")
            self._start_consultation(chosen, now, reason, notes)
            return chosen

        # -------------------------------------------------------------
        # Step 4: Idle
        # -------------------------------------------------------------
        if self.verbose_logging:
            print("   💤 [Decision: PRIORITY_4_IDLE] No eligible patients. Doctor idle.")
        return None

    def _start_consultation(
        self,
        patient: Patient,
        start_time: int,
        priority: PriorityReason,
        notes: str,
    ) -> None:
        patient.served = True
        patient.started_at = start_time
        patient.finished_at = start_time + patient.expected_duration
        patient.priority_assigned = priority

        self.history.append(
            ConsultationRecord(
                patient_name=patient.name,
                booked_time=format_time(patient.booked_time),
                arrival_time=format_time(patient.arrival_time),
                start_time=format_time(start_time),
                end_time=format_time(patient.finished_at),
                duration=patient.expected_duration,
                priority=priority,
                decision_notes=notes,
            )
        )


# =====================================================================
# Simulation & Verification Scenarios
# =====================================================================

def run_hospital_simulation():
    """
    Simulates the exact requested timeline:
    - Anil: Booked 7:00, Arrives 7:00 (On-time, starts 7:00)
    - Dev: Booked 7:30, Arrives 7:10 (Early, starts 7:10)
    - Esha: Booked 7:30, Arrives 7:15 (On-time window active at 7:20, starts 7:20)
    - Bala: Booked 7:10, Arrives 7:25 (Late, fit check passes before 7:40, starts 7:30)
    - Farah: Booked 7:50, Arrives 7:30 (Window opens 7:40, starts 7:40)
    - Chitra: Booked 7:20, Arrives 7:28 (Late queue, starts 7:50)
    """
    print("\n" + "#" * 70)
    print("🏥 RUNNING HOSPITAL QUEUE SIMULATION: PRIMARY TIMELINE")
    print("#" * 70)

    manager = ClinicQueueManager(window_tolerance=10, deadline_mode="window_open")

    # Patient Registry
    patients = [
        Patient(name="Anil", booked_time_input="7:00", arrival_time_input="7:00", expected_duration=10),
        Patient(name="Bala", booked_time_input="7:10", arrival_time_input="7:25", expected_duration=10),
        Patient(name="Dev", booked_time_input="7:30", arrival_time_input="7:10", expected_duration=10),
        Patient(name="Esha", booked_time_input="7:30", arrival_time_input="7:15", expected_duration=10),
        Patient(name="Farah", booked_time_input="7:50", arrival_time_input="7:30", expected_duration=10),
        Patient(name="Chitra", booked_time_input="7:20", arrival_time_input="7:28", expected_duration=10),
    ]

    for p in patients:
        manager.register_patient(p)

    # Trigger doctor_free events sequentially
    events = ["7:00", "7:10", "7:20", "7:30", "7:40", "7:50"]
    for event_time in events:
        manager.on_doctor_free(event_time)

    # Print summary table
    print("\n" + "=" * 70)
    print("📊 EXECUTION ORDER VERIFICATION TABLE")
    print("=" * 70)
    print(f"{'Patient':<10} {'Booked':<8} {'Arrived':<8} {'Started':<8} {'Ended':<8} {'Priority Rule Applied':<30}")
    print("-" * 75)
    for rec in manager.history:
        print(
            f"{rec.patient_name:<10} {rec.booked_time:<8} {rec.arrival_time:<8} "
            f"{rec.start_time:<8} {rec.end_time:<8} {rec.priority.value:<30}"
        )

    # Verification assertions
    expected_order = [
        ("Anil", "7:00"),
        ("Dev", "7:10"),
        ("Esha", "7:20"),
        ("Bala", "7:30"),
        ("Farah", "7:40"),
        ("Chitra", "7:50"),
    ]
    actual_order = [(rec.patient_name, rec.start_time) for rec in manager.history]
    assert actual_order == expected_order, f"Mismatch! Expected {expected_order}, got {actual_order}"
    print("\n✅ ALL TIMELINE ASSERTIONS PASSED PERFECTLY!\n")


def test_booking_order_precedence_in_late_queue():
    """
    Tests Invariant 2: The late queue is ordered by originally booked time,
    NOT by check-in / arrival time.
    """
    print("\n" + "#" * 70)
    print("🧪 TEST: LATE QUEUE BOOKING ORDER PRECEDENCE")
    print("#" * 70)

    manager = ClinicQueueManager(window_tolerance=10)

    # Patient X booked earlier (8:00) but arrived later (8:30)
    # Patient Y booked later (8:10) but arrived earlier (8:25)
    p_x = Patient(name="Patient_X (Booked 8:00, Arrived 8:30)", booked_time_input="8:00", arrival_time_input="8:30", expected_duration=10)
    p_y = Patient(name="Patient_Y (Booked 8:10, Arrived 8:25)", booked_time_input="8:10", arrival_time_input="8:25", expected_duration=10)

    manager.register_patient(p_x)
    manager.register_patient(p_y)

    # At 8:35, both are in late queue. Patient X must be chosen first despite checking in after Patient Y.
    selected = manager.on_doctor_free("8:35")
    assert selected is not None and selected.name == p_x.name, (
        f"Failed! Expected Patient X with earlier booked time, got {selected.name if selected else 'None'}"
    )
    print("✅ Booking order precedence strictly verified!")


def test_fit_check_rejection():
    """
    Tests Invariant 4: If late patient consultation exceeds deadline,
    Priority 2 fit check rejects them and doctor proceeds to Priority 3 (Early patient).
    """
    print("\n" + "#" * 70)
    print("🧪 TEST: FIT CHECK REJECTION (LATE EXCEEDS DEADLINE)")
    print("#" * 70)

    manager = ClinicQueueManager(window_tolerance=10, deadline_mode="window_open")

    # Late patient needing 25 minutes
    late_p = Patient(name="LatePatient", booked_time_input="9:00", arrival_time_input="9:25", expected_duration=25)
    # Early patient booked at 9:50 (window opens at 9:40)
    early_p = Patient(name="EarlyPatient", booked_time_input="9:50", arrival_time_input="9:30", expected_duration=10)

    manager.register_patient(late_p)
    manager.register_patient(early_p)

    # At 9:30, LatePatient would finish at 9:30 + 25 = 9:55 > 9:40 deadline.
    # Therefore, Fit Check should fail, and EarlyPatient should start instead!
    selected = manager.on_doctor_free("9:30")
    assert selected is not None and selected.name == early_p.name, (
        f"Failed! Expected EarlyPatient to be selected due to fit check failure, got {selected.name if selected else 'None'}"
    )
    print("✅ Fit check rejection & fallback to early patient strictly verified!")


if __name__ == "__main__":
    run_hospital_simulation()
    test_booking_order_precedence_in_late_queue()
    test_fit_check_rejection()
