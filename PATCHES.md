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

## Build / publish

CI: `.github/workflows/build-patched-image.yml` builds `docker/Dockerfile`
(EE) and pushes to `ghcr.io/reshifter1/chatwoot` (**private** - contains
proprietary `enterprise/` code, must not be public). Trigger via
`workflow_dispatch` or by pushing the patched files. The consumer
(`chatwoot-dokku`) pins the resulting image by digest.
