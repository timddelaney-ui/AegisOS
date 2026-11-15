"""Private S3-compatible object storage for attachment and document bytes."""
import os
from functools import lru_cache
from urllib.parse import urlsplit


class StorageConfigurationError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _client_and_bucket():
    endpoint = os.environ.get("R2_ENDPOINT_URL", "").strip()
    bucket = os.environ.get("R2_BUCKET_NAME", "").strip()
    access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    parsed = urlsplit(endpoint)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment
            or not bucket or not access_key or not secret_key):
        raise StorageConfigurationError("R2 storage configuration is incomplete or invalid.")

    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3", endpoint_url=endpoint, region_name="auto",
        aws_access_key_id=access_key, aws_secret_access_key=secret_key,
        config=Config(connect_timeout=10, read_timeout=60, retries={"max_attempts": 2}),
    ), bucket


def put_object(path: str, data: bytes, content_type: str) -> dict:
    client, bucket = _client_and_bucket()
    client.put_object(Bucket=bucket, Key=path, Body=data, ContentType=content_type)
    return {"path": path, "size": len(data), "storage_backend": "r2"}


def get_object(path: str) -> tuple:
    client, bucket = _client_and_bucket()
    response = client.get_object(Bucket=bucket, Key=path)
    body = response["Body"]
    try:
        return body.read(), response.get("ContentType", "application/octet-stream")
    finally:
        body.close()
