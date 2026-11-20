from bisect import bisect_right
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from itertools import groupby
from math import log10


DAY = timedelta(days=1)
GAP_SECONDS = 180
MIN_SESSION_SECONDS = 60
PRESETS = {"7d": 7, "30d": 30, "90d": 90}
LEVEL_THRESHOLDS = (70, 80, 85, 90)


def days(first, last, step=1):
    return (date.fromordinal(n) for n in range(first.toordinal(), last.toordinal() + 1, step))


def local_date(value, tz):
    return datetime.fromtimestamp(value, tz).date()


def midnight(day, tz):
    return int(datetime.combine(day, time.min, tz).timestamp())


def iso_time(value, tz):
    return datetime.fromtimestamp(value, tz).isoformat()


def select_range(samples, tz, preset, start, end, as_of):
    if preset not in {"all", "1y", *PRESETS}:
        raise ValueError("range must be all, 1y, 90d, 30d or 7d")
    if start is not None or end is not None:
        if start is None or end is None or preset != "all" or as_of is not None:
            raise ValueError("Provide start and end together, without range or as_of")
        first, last = date.fromisoformat(start), date.fromisoformat(end)
    elif preset == "all":
        if as_of is not None:
            raise ValueError("as_of requires a recent range")
        if not samples:
            return None
        first = local_date(samples[0][0], tz)
        last = local_date(max(sample[1] for sample in samples) - 1, tz)
    else:
        last = date.fromisoformat(as_of) if as_of else datetime.now(tz).date()
        if preset == "1y":
            try:
                anniversary = last.replace(year=last.year - 1)
            except ValueError:  # February 29
                anniversary = last.replace(year=last.year - 1, day=28)
            first = anniversary + DAY
        else:
            first = last - timedelta(days=PRESETS[preset] - 1)
    if first > last:
        raise ValueError("start must be on or before end")
    if (last - first).days > 36525 or first.year < 2 or last.year > 9998:
        raise ValueError("Date range supports up to 100 years within years 0002–9998")
    return first, last


def clip(samples, first, last):
    for start, end, level, device in samples:
        if end > first and start < last:
            yield max(start, first), min(end, last), level, device


def covered_segments(samples):
    events = []
    for start, end, level, device in samples:
        events.append((start, 1, level, device))
        events.append((end, -1, level, device))
    levels, devices = Counter(), Counter()
    previous = None
    for stamp, changes in groupby(sorted(events), key=lambda event: event[0]):
        if levels:
            yield previous, stamp, max(levels), tuple(devices)
        for _, delta, level, device in changes:
            levels[level] += delta
            devices[device] += delta
            if levels[level] == 0:
                del levels[level]
            if devices[device] == 0:
                del devices[device]
        previous = stamp


class Measurement:
    def __init__(self):
        self.seconds = 0
        self.energy = 0.0
        self.bands = [0] * (len(LEVEL_THRESHOLDS) + 1)

    def add(self, seconds, level):
        self.seconds += seconds
        self.energy += seconds * 10 ** (level / 10)
        self.bands[bisect_right(LEVEL_THRESHOLDS, level)] += seconds

    def values(self):
        average = round(10 * log10(self.energy / self.seconds), 2) if self.seconds else None
        above = sum(self.bands[2:])
        return {
            "seconds": self.seconds,
            "average_dba": average,
            "at_least_80_dba_seconds": above,
            "at_least_80_dba_ratio": above / self.seconds if self.seconds else None,
        }


def session_record(start, end, measurement, devices, tz):
    return {
        "start": iso_time(start, tz),
        "end": iso_time(end, tz),
        "device_ids": sorted(devices),
        **measurement.values(),
    }


def aggregate(samples, tz, include_clock=False):
    total = Measurement()
    daily = defaultdict(Measurement)
    clock = [[0] * 24 for _ in range(7)]
    sessions = []
    current = Measurement()
    session_start = session_end = None
    session_devices = set()
    for start, end, level, devices in covered_segments(samples):
        if session_end is None or start - session_end > GAP_SECONDS:
            if current.seconds >= MIN_SESSION_SECONDS:
                sessions.append(session_record(session_start, session_end, current, session_devices, tz))
            current = Measurement()
            session_start, session_devices = start, set()
        current.add(end - start, level)
        session_end = end
        session_devices.update(devices)
        total.add(end - start, level)
        while start < end:
            local = datetime.fromtimestamp(start, tz)
            boundary = local.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
            stop = min(end, int(boundary.timestamp()))
            daily[local.date()].add(stop - start, level)
            if include_clock:
                clock[local.weekday()][local.hour] += stop - start
            start = stop
    if current.seconds >= MIN_SESSION_SECONDS:
        sessions.append(session_record(session_start, session_end, current, session_devices, tz))
    return total, daily, sessions, clock


def overview(total, daily, sessions, period_days):
    seconds = total.seconds
    best_day = max(daily, key=lambda day: daily[day].seconds, default=None)
    return {
        **total.values(),
        "average_daily_seconds": seconds / period_days if period_days else None,
        "active_days": len(daily),
        "active_day_ratio": len(daily) / period_days if period_days else None,
        "average_active_day_seconds": seconds / len(daily) if daily else None,
        "session_count": len(sessions),
        "average_session_seconds": (
            sum(session["seconds"] for session in sessions) / len(sessions) if sessions else None
        ),
        "longest_session": max(sessions, key=lambda session: session["seconds"], default=None),
        "busiest_day": {"date": best_day.isoformat(), **daily[best_day].values()} if best_day else None,
    }


def trends(first, last, totals):
    daily, weekly, monthly = [], [], []
    for day in days(first, last):
        measurement = totals.get(day, Measurement())
        daily.append({"date": day.isoformat(), **measurement.values()})
        if not weekly or (day - first).days % 7 == 0:
            weekly.append((day, Measurement()))
        if not monthly or day.month != monthly[-1][0].month:
            monthly.append((day, Measurement()))
        for _, target in (weekly[-1], monthly[-1]):
            target.seconds += measurement.seconds
            target.energy += measurement.energy
            for i, seconds in enumerate(measurement.bands):
                target.bands[i] += seconds
    return {
        "daily": daily,
        "weekly": [
            {"start": day.isoformat(), "end": min(last, day + 6 * DAY).isoformat(), **item.values()}
            for day, item in weekly
        ],
        "monthly": [{"month": day.strftime("%Y-%m"), **item.values()} for day, item in monthly],
    }


def streak(daily):
    longest = current = 0
    previous = None
    for day in sorted(daily):
        current = current + 1 if previous is not None and day - previous == DAY else 1
        longest = max(longest, current)
        previous = day
    return longest


def listening_clock(clock, seconds):
    hours = [sum(column) for column in zip(*clock)]
    weekdays = [sum(row) for row in clock]
    return {
        "hourly_seconds": hours,
        "weekday_seconds": weekdays,
        "weekday_hour_seconds": clock,
        "peak_hour": hours.index(max(hours)) if seconds else None,
        "peak_weekday": weekdays.index(max(weekdays)) + 1 if seconds else None,
        "evening_ratio": sum(hours[18:]) / seconds if seconds else None,
    }


def histogram(values, boundaries):
    return [
        {"min_inclusive": lower, "max_exclusive": upper, "value": value}
        for lower, upper, value in zip((None, *boundaries), (*boundaries, None), values)
    ]


def comparisons(samples, last, tz):
    result = {}
    for window in (7, 30):
        windows = {}
        for key, end in (("current", last), ("previous", last - window * DAY)):
            start = end - (window - 1) * DAY
            total, _, sessions, _ = aggregate(
                clip(samples, midnight(start, tz), midnight(end + DAY, tz)), tz
            )
            windows[key] = {
                "start": start.isoformat(),
                "end": end.isoformat(),
                **total.values(),
                "session_count": len(sessions),
            }
        windows["change"] = {
            key: (
                windows["current"][key] - windows["previous"][key]
                if all(windows[period][key] is not None for period in ("current", "previous"))
                else None
            )
            for key in ("seconds", "average_dba", "session_count")
        }
        result[f"{window}d"] = windows
    return result


def report(rows, *, device=None, preset="all", start=None, end=None, as_of=None, offset=480):
    tz = timezone(timedelta(minutes=offset))
    samples = []
    device_samples = defaultdict(list)
    catalog = {}
    for identifier, name, maker, model, begin, finish, level in rows:
        sample = (begin, finish, level, identifier)
        catalog[identifier] = {"id": identifier, "name": name, "manufacturer": maker, "model": model}
        device_samples[identifier].append(sample)
        if device is None or device == identifier:
            samples.append(sample)
    if device is not None and device not in catalog:
        raise KeyError("Unknown device")
    bounds = select_range(samples, tz, preset, start, end, as_of)
    if bounds is None:
        low = high = period_days = 0
    else:
        first, last = bounds
        low, high = midnight(first, tz), midnight(last + DAY, tz)
        period_days = (last - first).days + 1
    total, daily, sessions, clock = aggregate(clip(samples, low, high), tz, include_clock=True)
    timeline = trends(first, last, daily) if bounds else {"daily": [], "weekly": [], "monthly": []}
    details = []
    names = Counter(item["name"] for item in catalog.values())
    for identifier, info in catalog.items():
        readings = device_samples[identifier]
        first_seen = local_date(readings[0][0], tz)
        last_seen = local_date(max(row[1] for row in readings) - 1, tz)
        device_total, device_days, device_sessions, _ = aggregate(clip(readings, low, high), tz)
        item = {
            **info,
            "label": f"{info['name']} · {first_seen:%Y-%m}" if names[info["name"]] > 1 else info["name"],
            "first_seen": first_seen.isoformat(),
            "last_seen": last_seen.isoformat(),
            **overview(device_total, device_days, device_sessions, period_days),
        }
        if bounds:
            item["monthly"] = trends(first, last, device_days)["monthly"]
        else:
            item["monthly"] = []
        details.append(item)
    details.sort(key=lambda item: (-item["seconds"], item["label"], item["id"]))
    device_seconds = sum(item["seconds"] for item in details)
    for item in details:
        item["share"] = item["seconds"] / device_seconds if device_seconds else None

    session_bands = (300, 900, 1800, 3600, 7200)
    durations = [0] * (len(session_bands) + 1)
    for session in sessions:
        durations[bisect_right(session_bands, session["seconds"])] += 1
    return {
        "range": None if bounds is None else {"start": first.isoformat(), "end": last.isoformat()},
        "offset_minutes": offset,
        "device_id": device,
        "summary": {
            **overview(total, daily, sessions, period_days),
            "longest_streak_days": streak(daily),
            "peak_week": max(timeline["weekly"], key=lambda item: item["seconds"]) if daily else None,
        },
        "devices": details,
        "timeline": timeline,
        "listening_clock": listening_clock(clock, total.seconds),
        "level_distribution": histogram(total.bands, LEVEL_THRESHOLDS),
        "session_duration_distribution": histogram(durations, session_bands),
        "comparisons": comparisons(samples, last, tz) if bounds else {},
    }, sessions
