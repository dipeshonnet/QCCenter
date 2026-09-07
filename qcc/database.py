from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.engine import Connection, CursorResult, Engine
from sqlalchemy.exc import IntegrityError as SAIntegrityError

from .config import settings


_engine: Engine | None = None
_IDENTITY_COLUMNS = {
    "users": "id",
    "accounts": "id",
    "processes": "id",
    "scorecard_versions": "id",
    "scorecard_items": "id",
    "sample_records": "id",
    "audit_responses": "id",
    "audit_defects": "id",
    "result_import_rows": "id",
    "capa_events": "id",
    "audit_events": "id",
}


def uses_postgres() -> bool:
    return settings.uses_postgres


def _postgres_engine() -> Engine:
    global _engine
    if _engine is None:
        connect_args: dict[str, Any] = {"sslmode": "verify-full"}
        if settings.database_ssl_root_cert_file:
            connect_args["sslrootcert"] = settings.database_ssl_root_cert_file
        _engine = create_engine(
            settings.database_url,
            pool_size=5,
            max_overflow=0,
            pool_timeout=10,
            pool_recycle=300,
            pool_pre_ping=True,
            connect_args=connect_args,
        )
    return _engine


class CompatRow(Mapping[str, Any]):
    def __init__(self, keys: Sequence[str], values: Sequence[Any]):
        self._keys = tuple(keys)
        self._values = tuple(values)
        self._mapping = dict(zip(self._keys, self._values, strict=False))

    def __getitem__(self, key: str | int) -> Any:
        if isinstance(key, int):
            return self._values[key]
        return self._mapping[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._keys)

    def __len__(self) -> int:
        return len(self._keys)


class CompatResult:
    def __init__(self, result: CursorResult[Any], *, returning_identity: bool = False):
        self._result = result
        self._keys = tuple(result.keys()) if result.returns_rows else ()
        self.lastrowid: int | None = None
        self._first: CompatRow | None = None
        if returning_identity:
            raw = result.fetchone()
            if raw is not None:
                self._first = CompatRow(self._keys, tuple(raw))
                self.lastrowid = int(raw[0])

    def fetchone(self) -> CompatRow | None:
        if self._first is not None:
            row, self._first = self._first, None
            return row
        raw = self._result.fetchone()
        return None if raw is None else CompatRow(self._keys, tuple(raw))

    def fetchall(self) -> list[CompatRow]:
        rows: list[CompatRow] = []
        if self._first is not None:
            rows.append(self._first)
            self._first = None
        rows.extend(CompatRow(self._keys, tuple(raw)) for raw in self._result.fetchall())
        return rows


def _translate_sql(sql: str) -> tuple[str, bool]:
    translated = sql.strip().rstrip(";")
    translated = re.sub(
        r"INSERT\s+OR\s+IGNORE\s+INTO",
        "INSERT INTO",
        translated,
        flags=re.IGNORECASE,
    )
    was_insert_or_ignore = bool(re.search(r"INSERT\s+OR\s+IGNORE\s+INTO", sql, re.IGNORECASE))
    translated = re.sub(
        r"([A-Za-z_][A-Za-z0-9_.]*)\s+COLLATE\s+NOCASE",
        r"LOWER(\1)",
        translated,
        flags=re.IGNORECASE,
    )
    match = re.match(r"INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)", translated, re.IGNORECASE)
    table = match.group(1).lower() if match else None
    if was_insert_or_ignore and " ON CONFLICT " not in translated.upper():
        translated += " ON CONFLICT DO NOTHING"
    returning_identity = bool(table in _IDENTITY_COLUMNS and " RETURNING " not in translated.upper())
    if returning_identity:
        translated += f" RETURNING {_IDENTITY_COLUMNS[table]}"
    translated = translated.replace("?", "%s")
    return translated, returning_identity


class PostgresConnection:
    def __init__(self, connection: Connection):
        self._connection = connection

    def execute(self, sql: str, params: Sequence[Any] = ()) -> CompatResult:
        translated, returning_identity = _translate_sql(sql)
        result = self._connection.exec_driver_sql(translated, tuple(params))
        return CompatResult(result, returning_identity=returning_identity)

    def executescript(self, _sql: str) -> None:
        raise RuntimeError("Runtime schema creation is disabled for PostgreSQL; run Alembic migrations")

    def commit(self) -> None:
        self._connection.commit()

    def rollback(self) -> None:
        self._connection.rollback()

    def close(self) -> None:
        self._connection.close()


def connect(db_path: Path) -> sqlite3.Connection | PostgresConnection:
    if uses_postgres():
        return PostgresConnection(_postgres_engine().connect())
    con = sqlite3.connect(db_path, timeout=30, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA journal_mode=WAL")
    return con


@contextmanager
def database(db_path: Path):
    con = connect(db_path)
    try:
        yield con
        con.commit()
    except SAIntegrityError as exc:
        con.rollback()
        raise sqlite3.IntegrityError("Database constraint failed") from exc
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
