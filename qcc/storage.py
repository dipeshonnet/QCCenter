from __future__ import annotations

import mimetypes
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator
from urllib.parse import quote

import httpx

from .config import settings


class StorageError(RuntimeError):
    pass


class StorageService:
    def __init__(self) -> None:
        self.remote = bool(settings.uses_postgres and settings.supabase_url and settings.supabase_secret_key)

    def object_key(self, upload_id: str, suffix: str) -> str:
        now = datetime.now(timezone.utc)
        return f"v1/ingest/{now:%Y/%m/%d}/{upload_id}{suffix.lower()}"

    def _headers(self) -> dict[str, str]:
        key = settings.supabase_secret_key or ""
        return {"Authorization": f"Bearer {key}", "apikey": key}

    def put_file(self, source: Path, object_key: str) -> str:
        if not self.remote:
            return str(source)
        mime = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        url = f"{settings.supabase_url}/storage/v1/object/{settings.ingest_bucket}/{quote(object_key, safe='/')}"
        with source.open("rb") as stream, httpx.Client(timeout=httpx.Timeout(20, connect=5)) as client:
            response = client.post(url, headers={**self._headers(), "Content-Type": mime, "x-upsert": "false"}, content=stream)
        if response.status_code not in {200, 201}:
            raise StorageError(f"Storage upload failed ({response.status_code})")
        return object_key

    def check_bucket(self) -> bool:
        if not self.remote:
            return True
        url = f"{settings.supabase_url}/storage/v1/bucket/{settings.ingest_bucket}"
        with httpx.Client(timeout=httpx.Timeout(2, connect=2)) as client:
            return client.get(url, headers=self._headers()).status_code == 200

    @contextmanager
    def materialize(self, reference: str, suffix: str) -> Iterator[Path]:
        if not self.remote:
            yield Path(reference)
            return
        url = f"{settings.supabase_url}/storage/v1/object/{settings.ingest_bucket}/{quote(reference, safe='/')}"
        with httpx.Client(timeout=httpx.Timeout(20, connect=5)) as client:
            response = client.get(url, headers=self._headers())
        if response.status_code != 200:
            raise StorageError(f"Storage download failed ({response.status_code})")
        temp = tempfile.NamedTemporaryFile(prefix="qcc-upload-", suffix=suffix, delete=False)
        path = Path(temp.name)
        try:
            temp.write(response.content)
            temp.close()
            yield path
        finally:
            temp.close()
            path.unlink(missing_ok=True)

    def delete(self, reference: str) -> None:
        if not self.remote:
            Path(reference).unlink(missing_ok=True)
            return
        url = f"{settings.supabase_url}/storage/v1/object/{settings.ingest_bucket}"
        with httpx.Client(timeout=httpx.Timeout(20, connect=5)) as client:
            response = client.request("DELETE", url, headers={**self._headers(), "Content-Type": "application/json"}, json={"prefixes": [reference]})
        if response.status_code not in {200, 204, 404}:
            raise StorageError(f"Storage delete failed ({response.status_code})")


storage = StorageService()
