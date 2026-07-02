# bit&pix Chatwoot fork

Fork of [`chatwoot/chatwoot`](https://github.com/chatwoot/chatwoot) carrying a
minimal patch for the bit&pix self-hosted deployment (`chat.bitandpix.ru`).

- **Base:** tag `v4.15.1` (matches the digest pinned in production at fork time).
- **Branch:** `bitandpix-4.15.1` (our commits live here; `upstream` remote =
  original repo).
- **Edition:** EE-identical to upstream `chatwoot/chatwoot:latest` (the
  `enterprise/` folder is kept; no license activated -> Community behaviour).
- **We do NOT track upstream.** No routine rebases; we pin one version and live
  on it. Revisit only if a specific fix is needed.

## Patch: preserve attachment order on batch upload

**Problem:** when an agent drops/pastes a batch of images into the reply box,
they appear (and are sent) in upload-completion order, not selection order -
smaller/faster files jump ahead.

**Root cause:** attachments are appended to `attachedFiles` inside async upload
callbacks (`DirectUpload.create` completion and `FileReader.onloadend`), so
array order = upload speed.

**Fix (2 files):**
- `app/javascript/dashboard/mixins/fileUploadMixin.js` - `onFileUpload` stamps a
  monotonic `uploadSeq` on each file synchronously (in `@input-file` selection
  order).
- `app/javascript/dashboard/components/widgets/conversation/ReplyBox.vue` -
  `attachFile` stores `uploadSeq` and sorts `attachedFiles` by it after each
  push, restoring selection order for the sent payload.

### Follow-up: compose-box preview order

The `uploadSeq` sort fixed the sent payload, but the compose-box preview
(`AttachmentsPreview.vue`) still showed upload-completion order. Its `v-for`
keys each row by `attachment.id`, and the objects `attachFile` pushed had no
`id` - so every row keyed by `undefined`, i.e. an unkeyed list. Vue patches
unkeyed lists by index, so an in-place `.sort()` of the same array reference did
not reorder the rendered thumbnails (the payload, which reads the array
directly, was already correct - hence "right in Telegram, wrong in the
preview"). Fix: `attachFile` now also stamps `id: file?.uploadSeq` on each
pushed object, giving the preview a stable unique key so it follows the sorted
order. Guarded by `AttachmentsPreview.spec.js` (in-place-sort reproduction) plus
a monotonic-`uploadSeq` test in `fileUploadMixin.spec.js`.

## Patch: deterministic attachment order in sent messages

**Problem:** even after the compose-box fix above, a sent multi-image message
rendered its thumbnails shuffled in the conversation bubble - while delivery to
Telegram stayed correct. "Right in Telegram, right in the compose box, wrong once
the message is created."

**Root cause:** `Message has_many :attachments` had no `ORDER BY`, so Postgres
returned attachments in an arbitrary order. The dashboard serializer
(`message.attachments.map(&:push_event_data)`), the realtime push, and later
`GET` requests could each get a different order for the same message. Verified on
prod: for message 165 the unordered association returned attachment ids
`[193, 192, 190, 191]` while `order(:id)` returned `[190, 191, 192, 193]` - and id
order matches `created_at`, blob id, and the send order (attachments are built in
`MessageBuilder#process_attachments` in the sent `files[]` order, so their serial
ids ascend in send order).

**Fix (1 file):**
- `app/models/message.rb` - scope the association: `has_many :attachments,
  -> { order(:id) }, ...`. One place fixes every consumer (bubble serializer,
  push, outgoing webhook the Telegram gateway reads).

Guarded by an ordering test in `spec/models/message_spec.rb`.

## Build / publish

CI: `.github/workflows/build-patched-image.yml` builds `docker/Dockerfile`
(EE) and pushes to `ghcr.io/reshifter1/chatwoot` (**private** - contains
proprietary `enterprise/` code, must not be public). Trigger via
`workflow_dispatch` or by pushing the patched files. The consumer
(`chatwoot-dokku`) pins the resulting image by digest.
