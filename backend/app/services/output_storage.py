import base64
from datetime import datetime, timedelta, timezone
import email.utils
import hmac
import hashlib
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class OutputStorageError(Exception):
    pass


class LocalOutputStorage:
    def upload(self, local_path: Path, object_key: str) -> str:
        if not local_path.exists() or local_path.stat().st_size <= 0:
            raise OutputStorageError(f"Output file is missing or empty: {local_path}")
        return f"/outputs/{local_path.name}"

    def upload_bytes(self, body: bytes, object_key: str, content_type: str) -> str:
        raise OutputStorageError("OSS storage is required for remote render artifacts")

    def normalize_key(self, object_key: str) -> str:
        return object_key.strip("/")

    def playback_url(
        self,
        url: str,
        public_base_url: str,
        expires_seconds: int,
    ) -> tuple[str, datetime]:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
        if url.startswith("/"):
            return f"{public_base_url.rstrip('/')}{url}", expires_at
        return url, expires_at


class AliyunOssOutputStorage:
    def __init__(
        self,
        endpoint: str,
        bucket: str,
        access_key_id: str,
        access_key_secret: str,
        prefix: str = "videos",
        public_base_url: str | None = None,
        timeout_seconds: float = 120,
    ) -> None:
        self.endpoint = endpoint.strip().rstrip("/")
        self.bucket = bucket.strip()
        self.access_key_id = access_key_id
        self.access_key_secret = access_key_secret.encode("utf-8")
        self.prefix = prefix.strip("/")
        self.public_base_url = public_base_url.strip().rstrip("/") if public_base_url else None
        self.timeout_seconds = timeout_seconds

    def upload(self, local_path: Path, object_key: str) -> str:
        if (
            not self.endpoint
            or not self.bucket
            or not self.access_key_id
            or not self.access_key_secret
        ):
            raise OutputStorageError("OSS endpoint, bucket, access key id, and access key secret are required")
        if not local_path.exists() or local_path.stat().st_size <= 0:
            raise OutputStorageError(f"Output file is missing or empty: {local_path}")

        body = local_path.read_bytes()
        return self.upload_bytes(body, object_key, "video/mp4")

    def upload_bytes(self, body: bytes, object_key: str, content_type: str) -> str:
        if (
            not self.endpoint
            or not self.bucket
            or not self.access_key_id
            or not self.access_key_secret
        ):
            raise OutputStorageError("OSS endpoint, bucket, access key id, and access key secret are required")
        if not body:
            raise OutputStorageError("Output body is empty")

        normalized_key = self.normalize_key(object_key)
        date = email.utils.formatdate(usegmt=True)
        resource = f"/{self.bucket}/{normalized_key}"
        string_to_sign = f"PUT\n\n{content_type}\n{date}\n{resource}"
        signature = base64.b64encode(
            hmac.new(self.access_key_secret, string_to_sign.encode("utf-8"), hashlib.sha1).digest()
        ).decode("ascii")
        request = urllib.request.Request(
            url=self._object_url(normalized_key),
            data=body,
            headers={
                "Authorization": f"OSS {self.access_key_id}:{signature}",
                "Content-Type": content_type,
                "Content-Length": str(len(body)),
                "Date": date,
            },
            method="PUT",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                status = getattr(response, "status", response.getcode())
                if status >= 300:
                    raise OutputStorageError(f"OSS upload failed with HTTP {status}")
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace")
            raise OutputStorageError(f"OSS upload failed with HTTP {exc.code}: {error_body[:1000]}") from exc
        except urllib.error.URLError as exc:
            raise OutputStorageError(f"OSS upload request failed: {exc}") from exc

        return self.public_url(normalized_key)

    def public_url(self, object_key: str) -> str:
        if self.public_base_url:
            return f"{self.public_base_url}/{urllib.parse.quote(object_key, safe='/')}"
        return self._object_url(object_key)

    def signed_get_url(self, object_key: str, expires_seconds: int) -> tuple[str, datetime]:
        if (
            not self.endpoint
            or not self.bucket
            or not self.access_key_id
            or not self.access_key_secret
        ):
            raise OutputStorageError("OSS endpoint, bucket, access key id, and access key secret are required")

        normalized_key = self.normalize_key(object_key)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_seconds)
        expires = str(int(expires_at.timestamp()))
        resource = f"/{self.bucket}/{normalized_key}"
        string_to_sign = f"GET\n\n\n{expires}\n{resource}"
        signature = base64.b64encode(
            hmac.new(self.access_key_secret, string_to_sign.encode("utf-8"), hashlib.sha1).digest()
        ).decode("ascii")
        query = urllib.parse.urlencode(
            {
                "OSSAccessKeyId": self.access_key_id,
                "Expires": expires,
                "Signature": signature,
            }
        )
        separator = "&" if "?" in self.public_url(normalized_key) else "?"
        return f"{self.public_url(normalized_key)}{separator}{query}", expires_at

    def normalize_key(self, object_key: str) -> str:
        key = object_key.strip("/")
        if self.prefix and not key.startswith(f"{self.prefix}/"):
            key = f"{self.prefix}/{key}"
        return key

    def _object_url(self, object_key: str) -> str:
        parsed = urllib.parse.urlparse(self.endpoint)
        if parsed.scheme:
            scheme = parsed.scheme
            netloc = parsed.netloc
        else:
            scheme = "https"
            netloc = self.endpoint
        return f"{scheme}://{self.bucket}.{netloc}/{urllib.parse.quote(object_key, safe='/')}"
