from contextlib import closing, contextmanager
from datetime import datetime
from hashlib import sha256
from pathlib import PurePosixPath
import math
import re
import sqlite3
from xml.parsers import expat
from zipfile import ZipFile


EXPOSURE_TYPE = "HKQuantityTypeIdentifierHeadphoneAudioExposure"
DEVICE_FIELD = re.compile(
    r"(?:^|,\s*)(name|manufacturer|model|localIdentifier|UDI):\s*(.*?)"
    r"(?=,\s*(?:name|manufacturer|model|localIdentifier|UDI|creation date|hardware|firmware|software):|$)"
)
SCHEMA = """
CREATE TABLE IF NOT EXISTS exposures (
    device_id TEXT NOT NULL,
    name TEXT NOT NULL,
    manufacturer TEXT,
    model TEXT,
    start INTEGER NOT NULL,
    end INTEGER NOT NULL,
    level REAL NOT NULL,
    PRIMARY KEY (device_id, start, end, level)
) WITHOUT ROWID;
"""


def connect(path):
    return sqlite3.connect(path, timeout=30)


def device_details(attributes):
    raw = attributes.get("device", "")
    details = dict(DEVICE_FIELD.findall(raw.strip("<>")))
    name = details.get("name") or "未知耳机"
    maker, model = details.get("manufacturer"), details.get("model")
    identifier = details.get("localIdentifier") or details.get("UDI")
    if identifier:
        identity = re.sub(r"(-tacl|-tsco)$", "", identifier, flags=re.IGNORECASE).lower()
        identity = "hardware:" + identity
    else:
        identity = repr((name, maker, model, attributes.get("sourceName") if name == "未知耳机" else None))
    return sha256(identity.encode()).hexdigest(), name, maker, model


def timestamp(value):
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise ValueError("Timestamp needs an offset")
    return int(parsed.timestamp())


@contextmanager
def health_xml(path):
    suffix = path.suffix.lower()
    if suffix == ".xml":
        with path.open("rb") as stream:
            yield stream
        return
    if suffix != ".zip":
        raise ValueError("Expected an Apple Health ZIP or XML file")
    with ZipFile(path) as archive:
        candidates = [
            item for item in archive.infolist()
            if not item.is_dir() and "__MACOSX" not in PurePosixPath(item.filename).parts
            and PurePosixPath(item.filename).suffix.lower() == ".xml"
            and PurePosixPath(item.filename).name.lower() != "export_cda.xml"
        ]
        preferred = [
            item for item in candidates
            if PurePosixPath(item.filename).parent.name == "apple_health_export"
        ]
        choices = preferred or candidates
        standard = [item for item in choices if PurePosixPath(item.filename).name.lower() == "export.xml"]
        choices = standard or choices
        if len(choices) != 1:
            raise ValueError("Could not identify a single HealthData XML in the ZIP")
        with archive.open(choices[0]) as stream:
            yield stream


def import_export(path, database):
    database.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect(database)) as db, health_xml(path) as stream, db:
        db.executescript(SCHEMA)
        db.execute("BEGIN")
        batch = []
        seen = invalid = 0
        first_element = True

        def flush():
            db.executemany("INSERT OR IGNORE INTO exposures VALUES (?, ?, ?, ?, ?, ?, ?)", batch)
            batch.clear()

        def start_element(tag, attributes):
            nonlocal first_element, seen, invalid
            if first_element:
                first_element = False
                if tag != "HealthData":
                    raise ValueError("Expected Apple Health HealthData XML")
            if tag != "Record" or attributes.get("type") != EXPOSURE_TYPE:
                return
            seen += 1
            try:
                start = timestamp(attributes["startDate"])
                end = timestamp(attributes["endDate"])
                level = float(attributes["value"])
                if end <= start or not math.isfinite(level) or not -100 <= level <= 200:
                    raise ValueError
                if attributes.get("unit") != "dBASPL":
                    raise ValueError
            except (KeyError, ValueError, OverflowError, OSError):
                invalid += 1
                return
            batch.append((*device_details(attributes), start, end, level))
            if len(batch) >= 2000:
                flush()

        def reject_entities(*args):
            raise ValueError("Custom XML entities are unsupported")

        parser = expat.ParserCreate()
        parser.StartElementHandler = start_element
        parser.EntityDeclHandler = reject_entities
        parser.ParseFile(stream)
        flush()
        return {
            "records_found": seen,
            "inserted": db.total_changes,
            "duplicates": seen - invalid - db.total_changes,
            "skipped": invalid,
        }


def read_exposures(database):
    with closing(connect(database)) as db:
        db.executescript(SCHEMA)
        return db.execute("""
            SELECT device_id, name, manufacturer, model, start, end, level
            FROM exposures ORDER BY start, end, device_id, level
        """).fetchall()
