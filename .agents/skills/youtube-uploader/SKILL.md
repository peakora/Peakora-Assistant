---
name: youtube-uploader
description: "youtube-uploader - Headless YouTube publishing agent"
allowed-tools: Read
metadata:
  version: 1.0.0
---

# youtube-uploader  -  Headless YouTube publishing agent

## Status
**REAL / WORKING**  -  reference implementation drawn from `PeakoraEngine/peakora_schedule.py`.
CPU/free. Uses the YouTube Data API v3 + google-auth-oauthlib.

## When to use
Invoke when a task needs to publish a video to YouTube headlessly  -  uploading an
MP4, setting title/description/tags, marking it as a Short, and pinning a
comment. Also when a repo needs YouTube OAuth token auto-refresh + Brand Account
routing. Recalled automatically for Python repos doing video distribution.

## Capabilities
- Upload a local MP4 via resumable upload (`MediaFileUpload`).
- Mark as Short (`is_short` → shorts metadata).
- Set title, description (full Master Vault caption), tags, category, privacy.
- Pin a comment to the uploaded video.
- Auto-refresh expired OAuth credentials from a token JSON file and persist the
  refreshed token (long-lived refresh tokens keep the flow unattended).
- Multi-account routing: accept a token path + optional channel/Brand Account.

## Env / inputs
- `TOKEN_YOUTUBE_PATH` (or param)  -  path to `token_youtube.json` (OAuth user token).
- In CI, `GCP_TOKEN_YOUTUBE_BASE64` is base64-decoded to the token file at run
  start (see PeakoraEngine workflow's "Inject Google Token Secrets" step).
- Scopes: `https://www.googleapis.com/auth/youtube.upload`,
  `https://www.googleapis.com/auth/youtube.force-ssl` (for comment pinning).

## Reference implementation
```python
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",
]

def get_google_creds(token_path, scopes):
    """Loads credentials from a token JSON file, auto-refreshing if expired."""
    creds = Credentials.from_authorized_user_file(token_path, scopes)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        with open(token_path, "w") as token_file:
            token_file.write(creds.to_json())
    return creds

def publish_to_youtube(yt_creds, local_path, filename, is_short=True,
                       title=None, description="", tags=None):
    service = build("youtube", "v3", credentials=yt_creds)
    body = {
        "snippet": {"title": title or filename, "description": description,
                    "tags": tags or [], "categoryId": "22"},
        "status": {"privacyStatus": "public", "selfDeclaredMadeForKids": False},
    }
    media = MediaFileUpload(local_path, mimetype="video/mp4", resumable=True, chunksize=-1)
    request = service.videos().insert(part="snippet,status", body=body, media_body=media)
    response = None
    while response is None:
        _status, response = request.next_chunk()
    return response.get("id")

def pin_comment(yt_creds, video_id, comment_text):
    service = build("youtube", "v3", credentials=yt_creds)
    created = service.commentThreads().insert(
        part="snippet",
        body={"snippet": {"videoId": video_id,
              "topLevelComment": {"snippet": {"textOriginal": comment_text}}}},
    ).execute()
    service.comments().setTopComment(id=created["id"]).execute()
```

## Notes
- Token files contain live OAuth refresh tokens  -  NEVER commit them. Inject via
  CI secrets (base64). See PeakoraEngine's security hardening (2026-08-16).
- For Instagram + Facebook Reels posting in the same flow, pair with the Meta
  Graph API layer in `peakora_schedule.py` (`publish_to_meta`).
