from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from backend.api.views import dashboard_view

KL_TZ = ZoneInfo("Asia/Kuala_Lumpur")


def test_dashboard_view_week_period_comparison():
    # 2026-09-20 is Sunday; current week is 2026-09-14 to 2026-09-20.
    # Previous week is 2026-09-07 to 2026-09-13.
    now = datetime(2026, 9, 20, 12, 0, tzinfo=KL_TZ)

    cases = [
        # Current week: 3 cases
        {
            "case_id": "c1",
            "created_at": "2026-09-15T10:00:00Z",
            "result": {"status": "OK"},
            "processing_state": "TERMINAL",
        },
        {
            "case_id": "c2",
            "created_at": "2026-09-18T14:30:00Z",
            "result": {"status": "MISMATCH"},
            "processing_state": "TERMINAL",
        },
        {
            "case_id": "c3",
            "created_at": "2026-09-20T02:00:00Z",
            "result": {"status": "NEEDS_REVIEW"},
            "processing_state": "TERMINAL",
        },
        # Previous week: 2 cases
        {
            "case_id": "c4",
            "created_at": "2026-09-08T09:00:00Z",
            "result": {"status": "OK"},
            "processing_state": "TERMINAL",
        },
        {
            "case_id": "c5",
            "created_at": "2026-09-12T16:00:00Z",
            "result": {"status": "OK"},
            "processing_state": "TERMINAL",
        },
        # Older: 1 case
        {
            "case_id": "c6",
            "created_at": "2026-08-30T12:00:00Z",
            "result": {"status": "OK"},
            "processing_state": "TERMINAL",
        },
    ]

    result = dashboard_view(cases, "week", now=now)
    metrics = result["metrics"]

    assert metrics["total"] == 3
    assert metrics["previous_total"] == 2
    # ((3 - 2) / 2) * 100 = 50%
    assert metrics["delta_pct"] == 50
    assert metrics["matches"] == 1
    assert metrics["mismatches"] == 1
    assert metrics["needs_review"] == 1


def test_dashboard_view_day_period_comparison():
    # 2026-09-20 15:00 KL; today starts 2026-09-20 00:00 KL (2026-09-19 16:00 UTC).
    # Yesterday is 2026-09-19 00:00 to 2026-09-20 00:00 KL.
    now = datetime(2026, 9, 20, 15, 0, tzinfo=KL_TZ)

    cases = [
        # Today in KL
        {"case_id": "t1", "created_at": "2026-09-20T04:00:00Z", "result": {"status": "OK"}},
        # Yesterday in KL
        {"case_id": "y1", "created_at": "2026-09-19T02:00:00Z", "result": {"status": "OK"}},
        {"case_id": "y2", "created_at": "2026-09-19T10:00:00Z", "result": {"status": "OK"}},
        {"case_id": "y3", "created_at": "2026-09-19T14:00:00Z", "result": {"status": "OK"}},
        {"case_id": "y4", "created_at": "2026-09-19T15:00:00Z", "result": {"status": "OK"}},
    ]

    result = dashboard_view(cases, "day", now=now)
    metrics = result["metrics"]

    assert metrics["total"] == 1
    assert metrics["previous_total"] == 4
    # ((1 - 4) / 4) * 100 = -75%
    assert metrics["delta_pct"] == -75


def test_dashboard_view_month_and_year_boundary():
    # January reference to verify proper roll-over to previous December
    now = datetime(2026, 1, 10, 12, 0, tzinfo=KL_TZ)

    cases = [
        # This month (Jan 2026): 2 cases
        {"case_id": "m1", "created_at": "2026-01-02T10:00:00Z", "result": {"status": "OK"}},
        {"case_id": "m2", "created_at": "2026-01-05T10:00:00Z", "result": {"status": "OK"}},
        # Previous month (Dec 2025): 1 case
        {"case_id": "m3", "created_at": "2025-12-25T10:00:00Z", "result": {"status": "OK"}},
        # Earlier: Nov 2025
        {"case_id": "m4", "created_at": "2025-11-15T10:00:00Z", "result": {"status": "OK"}},
    ]

    result = dashboard_view(cases, "month", now=now)
    metrics = result["metrics"]

    assert metrics["total"] == 2
    assert metrics["previous_total"] == 1
    # ((2 - 1) / 1) * 100 = 100%
    assert metrics["delta_pct"] == 100


def test_dashboard_view_zero_baseline_handling():
    now = datetime(2026, 9, 20, 12, 0, tzinfo=KL_TZ)

    # When both current and previous are 0
    res_empty = dashboard_view([], "week", now=now)
    assert res_empty["metrics"]["total"] == 0
    assert res_empty["metrics"]["previous_total"] == 0
    assert res_empty["metrics"]["delta_pct"] == 0

    # When previous is 0 and current > 0 -> 100%
    cases_curr_only = [
        {"case_id": "c1", "created_at": "2026-09-18T10:00:00Z", "result": {"status": "OK"}}
    ]
    res_growth = dashboard_view(cases_curr_only, "week", now=now)
    assert res_growth["metrics"]["total"] == 1
    assert res_growth["metrics"]["previous_total"] == 0
    assert res_growth["metrics"]["delta_pct"] == 100

    # When previous > 0 and current is 0 -> -100%
    cases_prev_only = [
        {"case_id": "c1", "created_at": "2026-09-10T10:00:00Z", "result": {"status": "OK"}}
    ]
    res_drop = dashboard_view(cases_prev_only, "week", now=now)
    assert res_drop["metrics"]["total"] == 0
    assert res_drop["metrics"]["previous_total"] == 1
    assert res_drop["metrics"]["delta_pct"] == -100


def test_dashboard_view_turnaround_time_calculation():
    now = datetime(2026, 9, 20, 12, 0, tzinfo=KL_TZ)

    cases = [
        {
            "case_id": "c1",
            "created_at": "2026-09-18T10:00:00Z",
            "updated_at": "2026-09-18T10:00:03Z",  # 3s
            "processing_state": "TERMINAL",
            "result": {"status": "OK"},
        },
        {
            "case_id": "c2",
            "created_at": "2026-09-18T11:00:00Z",
            "updated_at": "2026-09-18T11:00:07Z",  # 7s
            "processing_state": "TERMINAL",
            "result": {"status": "OK"},
        },
    ]

    result = dashboard_view(cases, "week", now=now)
    # Average turnaround: (3 + 7) / 2 = 5.0s
    assert result["metrics"]["avg_turnaround"] == "5.0s"

    # Default fallback when no completed durations exist
    cases_no_duration = [
        {
            "case_id": "c3",
            "created_at": "2026-09-18T10:00:00Z",
            "updated_at": "2026-09-18T10:00:00Z",
            "processing_state": "PROCESSING",
        }
    ]
    res_live = dashboard_view(cases_no_duration, "week", now=now)
    assert res_live["metrics"]["avg_turnaround"] == "Live"


def test_build_case_summary_carries_email_body():
    from backend.api.views import build_case_summary

    case = {
        "case_id": "case-test-body",
        "sender": "shipper@example.com",
        "subject": "SI for Booking 123",
        "body": "Dear Team,\n\nPlease find the attached documents.",
        "html_body": "<p>Dear Team,<br>Please find the attached documents.</p>",
        "created_at": "2026-09-20T10:00:00Z",
        "result": {"status": "OK"},
    }

    summary = build_case_summary(case)
    assert summary["body"] == "Dear Team,\n\nPlease find the attached documents."
    assert summary["html_body"] == "<p>Dear Team,<br>Please find the attached documents.</p>"

