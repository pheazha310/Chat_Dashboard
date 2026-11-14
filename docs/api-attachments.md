# Files, media and voice messages API (FR-17, FR-18)

Agents send files and recorded voice messages; every participant who may see the conversation can list, preview and
download them. Routes are under `/api/v1/admin` and need a dashboard bearer token. The bytes live in a storage
provider; PostgreSQL holds only the metadata (`attachments`, `message_attachments`).

Envelope: `{ "status": "success", "data": ... }`. Interactive reference: `GET /api/v1/admin/openapi.json`.

## Endpoints

| Method and path                                      | Purpose                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /attachments/upload`                           | Multipart: `file`, `conversationId`, `clientId`, optional `text` (caption). Sends a message carrying the file.                                          |
| `POST /conversations/:conversationId/voice-messages` | Multipart: `file` (audio), `clientId`, optional `durationMs`, optional `waveform` (JSON array of up to 200 integers 0 to 255). Sends a `VOICE` message. |
| `GET /conversations/:conversationId/attachments`     | Shared media and files, newest first. `kind` = `image`, `document`, `audio`, `video` or `voice`; `page`, `size`.                                        |
| `GET /attachments/:attachmentId`                     | Metadata.                                                                                                                                               |
| `GET /attachments/:attachmentId/download`            | The bytes. `?inline=1` shows images, audio and video in the page; other types are always a download. One `Range` is supported (206).                    |
| `GET /messages/:messageId/audio`                     | The audio of a voice or audio message, inline, with `Range`.                                                                                            |
| `DELETE /attachments/:attachmentId`                  | Soft delete only; the stored bytes are kept.                                                                                                            |

Upload and voice answer `201` with the created `Message`, or `200` with the original on a retry of the same `clientId`.
The message carries `attachments[]`:

```json
{
  "id": "…",
  "type": "VOICE",
  "content": null,
  "attachments": [
    {
      "id": "…",
      "messageId": "…",
      "kind": "AUDIO",
      "filePath": "conversations/…/….webm",
      "fileName": "voice-message.webm",
      "mimeType": "audio/webm",
      "fileSize": 18234,
      "durationMs": 4200,
      "waveform": [10, 80, 255, 0],
      "uploadedById": "…",
      "createdAt": "…",
      "downloadPath": "/attachments/…/download"
    }
  ]
}
```

Message type is `IMAGE`, `FILE` (documents), `AUDIO`, `VIDEO` or `VOICE`. With no caption the inbox preview reads
`Photo: name`, `File: name` and so on, or `Voice message`.

## Validation

A file is accepted only when **all** of these hold, otherwise `400` and nothing is stored:

- Its MIME type is on the allow-list: JPEG, PNG, GIF, WebP; PDF, TXT, CSV, DOC, DOCX, XLS, XLSX; MP3, OGG, WAV, WebM
  audio, M4A; MP4, WebM and MOV video. SVG, HTML, scripts, archives and executables are refused because a browser could
  run them.
- Its extension belongs to that type, so `photo.jpg` declared as PNG is refused.
- Its first bytes match the type (magic numbers), so a renamed HTML file cannot pass as an image. Text files must not
  contain NUL bytes.
- Its size is within the limit for the type: images 10 MB, text and CSV 5 MB, other files 25 MB. Voice recordings are
  at most 10 MB and must be audio. `MAX_UPLOAD_BYTES` (default 25 MB) is the hard cap for any request (`413`).
- It is not empty.

Parameters in the MIME type (`audio/webm;codecs=opus`) are ignored. The file name is only a label: it is stripped of
paths and control characters and limited to 255 characters, and it never reaches the file system.

## Authorization

| Action                         | Who                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Upload, voice message          | The owner of an open conversation (same rule as sending a message); 403 otherwise, 404 if the conversation is hidden. |
| List, details, download, audio | Anyone who may see the conversation (`canView`, supervisors included). A hidden conversation's files answer `404`.    |
| Delete                         | The uploader, or a supervisor/admin.                                                                                  |

Customers cannot use these routes (the dashboard token roles only). Deleting a message also soft-deletes its files.

## `filePath` and privacy

Every attachment carries `filePath`: the storage key stored in `attachments.storage_key` (`conversations/<conversationId>/<uuid>.<ext>`).
It is only a path inside the storage (local folder or S3 bucket). It never holds a URL, bucket name, host or signature, so the
storage location stays private. Clients cannot fetch it directly; the bytes come from `downloadPath` after the access check.

## Secure preview and download

The download endpoint streams the file after the access check. It needs the bearer token, which `<img src>` cannot send,
so the dashboard fetches the bytes with the token and shows them from a `blob:` URL (`useAttachmentUrl`). Signed URLs
are not used, even with the `s3` driver: the streaming endpoint keeps the check on every request and the same download
contract for every driver.
Responses carry `Content-Type` from the allow-list, `X-Content-Type-Options: nosniff`,
`Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: private` and `Content-Disposition` (`attachment`
unless inline is allowed for the type).

## Storage

`Storage` (`backend/src/shared/storage/`) has `put`, `stat`, `open` (with a byte range) and `delete`. Keys are
generated by the server: `conversations/<conversationId>/<uuid>.<ext>`. `STORAGE_DRIVER` picks the driver:

- `local` (default, one server): files under `STORAGE_DIR/<key>`, written to a temp file and renamed, so a crash never
  leaves a half-written file.
- `s3` (several servers): objects under `<key>` in `S3_BUCKET`, on AWS S3 or an S3-compatible store (MinIO, Cloudflare
  R2, ...) through `S3_ENDPOINT`. Downloads still stream through the API (the object, or the requested range, is read
  from S3 per request). A single `PutObject` stores a file whole, so there are no partial objects either. Credentials
  come from the standard AWS chain: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, a shared profile, or the server's
  IAM role. They are never in `env.ts`. The bucket should be private; the API needs `s3:PutObject`, `s3:GetObject` and
  `s3:DeleteObject` on it (`HeadObject` uses `GetObject`; grant `s3:ListBucket` too so a missing key answers 404, not 403).

| Variable              | Default     | Meaning                                                                          |
| --------------------- | ----------- | -------------------------------------------------------------------------------- |
| `STORAGE_DRIVER`      | `local`     | Storage driver: `local` or `s3`.                                                 |
| `STORAGE_DIR`         | `./storage` | Root directory for the local driver (git-ignored).                               |
| `S3_BUCKET`           |             | Bucket for the `s3` driver (required with it).                                   |
| `S3_REGION`           |             | Region for the `s3` driver (required with it; e.g. `ap-southeast-1`, R2 `auto`). |
| `S3_ENDPOINT`         |             | Endpoint URL of an S3-compatible store; leave empty for AWS.                     |
| `S3_FORCE_PATH_STYLE` | `false`     | `true` puts the bucket in the path instead of the host name (MinIO needs it).    |
| `MAX_UPLOAD_BYTES`    | `26214400`  | Hard cap for one upload request.                                                 |

Uploads are buffered in memory (at most `MAX_UPLOAD_BYTES` per request) before being written; size the server for the
expected number of simultaneous uploads.

## Failure and cleanup

- The file is stored first, then the message and metadata are saved in one transaction. If saving fails, the stored
  file is removed and the error is returned; the client shows the message as failed and can retry with the same
  `clientId`.
- A retry of an existing `clientId` returns the original message and the just-stored duplicate is removed.
- Deleting an attachment or its message soft-deletes the record (`deleted_at`); the bytes stay in storage and are no
  longer served. Only an upload that was never saved against a message (a failed save or a duplicate `clientId`) has
  its stored file removed.
- **Not built:** a sweep for orphans left by a crash between storing the bytes and committing the message, and
  `PENDING`/`FAILED` upload states (an attachment row only exists once its bytes are stored, so it is `UPLOADED`).

## WebSocket events (server to client)

Common to both: **Sender** the server, after the change committed. **Authentication** the `/ws` first-frame token.
**Authorization** delivered per socket to whoever may see the conversation. **Acknowledgment** none. **Error handling**
a failed publish is logged and never fails the REST call; clients re-read history on reconnect.

| Event                 | Payload                             | Server-side logic                                                                                 |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `attachment.uploaded` | `{ attachment }`                    | After a file or voice message was stored, together with `message.new` and `conversation.updated`. |
| `attachment.deleted`  | `{ id, conversationId, messageId }` | After `DELETE /attachments/:id`. Remove the file from the message.                                |

The dashboard's vocabulary is `attachment.deleted` with `{ conversationId, messageId, attachmentId }`.

## Frontend

`shared/api/rest/attachments.ts` (XHR upload with progress, authorized blob fetch), `entities/message` (`AttachmentView`
renders images, audio, video and download buttons), `features/send-message` (file chosen in the composer, caption from
the draft, progress, retry; voice recording with `MediaRecorder` in WebM, Ogg or MP4 audio), and
`features/share-files` (the shared media panel lists the conversation's real files and downloads them). Against the
mock server the composer keeps its old behaviour.

- Recording starts and stops with the microphone button; stopping sends the message at once and the small `×` cancels.
  There is no preview-before-send step yet, and the waveform is not computed by the browser (the API accepts one).
- Uploading from the media panel is not offered with the real backend: a file is always sent as a message from the
  composer.

## Tests

`pnpm --filter @chat-dashboard/backend test` covers validation (types, extensions, signatures, sizes, voice), range
parsing, and the service with mocked storage (key generation, cleanup on failure, duplicate retry, access rules).
`attachments-api.integration.test.ts` runs the real app over HTTP against PostgreSQL and a temporary storage directory:
multipart upload, idempotency, exact bytes and headers on download, ranges and 416, access for other agents,
supervisors, customers and anonymous callers, rejection of unsafe files without leaving anything behind, voice messages
with duration and waveform, playback with ranges, deleting a file and deleting its message, and file names never
reaching the storage path. `s3-storage.test.ts` checks the `s3` driver's requests against a fake client, and
`s3-storage.integration.test.ts` runs it against a real S3-compatible store when `TEST_S3_ENDPOINT` and `TEST_S3_BUCKET`
are set (instructions at the top of that file); otherwise it is skipped.
