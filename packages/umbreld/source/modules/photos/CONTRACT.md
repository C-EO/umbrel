# Photos v1 — backend contract

What umbreld provides for the Photos UI. A logical photo is identified by its
32-byte BLAKE3 content hash. Durable account/hash state lives in namespaced
`photos_*` tables in the shared `<dataDirectory>/umbrel.db`; filesystem
locations, content hashes, media metadata, search terms, and thumbnail work live
in the disposable `<dataDirectory>/file-index/index.db` or artifact directories.
The shared database is backed up and is never quarantined with the rebuildable
index.

Account and path authorization is applied before locations are grouped by hash.
Consequently, duplicate bytes are returned once per Home/Trash view without
revealing copies that belong to another account. For path-based operations, the
backend chooses the first currently accessible location ordered by root virtual
path and relative path, and falls back to the next location if it disappears.
Filename search considers every accessible duplicate in the selected view, not
just that canonical location. Home source filters never hide Trash media. Items
are omitted until their hash and media metadata are ready; the separate
indexing-state procedure tells the client when the Home result set is still
warming.

Files Trash is the only deletion source of truth. The normal library projects
media from the account's Home root; the Deleted view projects every indexed
photo/video from that account's Trash root. There is no Photos deletion marker,
retention period, or automatic cleanup. Trash therefore needs the same hashes,
media metadata, live-pair data, and Photos thumbnail variants as Home.

Not in v1 (no routers or fields exist for them): people, locations, semantic
search, Android motion photos (the MP4-embedded-in-a-JPEG kind — needs byte
slicing at import; Apple live pairs are in, see SubKinds). Search suggestions are
built client-side from `library.summary` + `sources.list` + `albums.list` — no
suggest endpoint. The importer should still extract and index everything it
reads in its one pass over the file — GPS coordinates included — so Locations
and friends can ship later without re-scanning the library; v1 exposes only
the raw coordinates on `ItemDetail`, nothing else.

## Vocabulary

```ts
type Kind = 'photo' | 'video'
// Presentation tier over Kind, derived once at import — see SubKinds below.
// Absent = plain photo/video.
type SubKind = 'live' | 'panorama' | 'screenshot' | 'spherical'
// Android, drives and network shares land after v1
type SourceType = 'umbrel' | 'iphone'
type ScopeMode = 'everything' | 'everything-except' | 'only'
```

## Shapes

```ts
// Grid item — deliberately lean, the grid holds tens of thousands
type Item = {
	id: string // lowercase 64-character BLAKE3 hex digest
	kind: Kind
	subKind?: SubKind
	takenAt: number // epoch ms; embedded capture time, else indexed birth time, else modification time
	// The offset matching the selected EXIF date as minutes east of UTC, when present.
	takenAtOffsetMinutes?: number
	width: number // pixels, after EXIF orientation
	height: number
	durationMs?: number // videos only
	isFavorite: boolean
	tint?: number // average colour packed 0xRRGGBB, computed once at import
}

// The viewer's info panel
type ItemDetail = Item & {
	fileName: string
	sizeBytes: number
	source: {id: string; name: string; type: SourceType}
	path: string // virtual path in the selected Home or Trash projection ("Show in Files")
	createdAt: number // embedded creation/capture time, else indexed birth time, else modification time
	importedAt: number // epoch ms the import wrote the row
	// Partial camera metadata plus EXIF UserComment. Camera values are
	// display-ready strings, except iso.
	exif?: {
		make?: string
		model?: string
		lens?: string
		focalLength?: string
		aperture?: string
		exposure?: string
		iso?: number
		userComment?: string
	}
	// Raw EXIF coordinates, straight off the index — the info panel's location
	// row (formatted coords + an "Open in Maps" link out).
	location?: {lat: number; lng: number; altitude?: number}
	albums: {id: string; name: string}[]
}

// All clauses AND together; within one array, any match counts.
// Each field is one predicate — the UI's sidebar sections are just presets
// (Favorites = {favorite: true}, Deleted = {deleted: true}, …).
type Filter = {
	query?: string // every term must appear in the file name, camera make/model, or UserComment
	kind?: Kind
	subKind?: SubKind // the Panoramas / Screenshots / Live Photos / 360° sections
	favorite?: boolean // absent = don't care
	deleted?: boolean // absent or false = live items only; true = deleted items only
	sourceIds?: string[]
	albumIds?: string[]
	dates?: {from: number; to: number}[] // half-open [from, to) over takenAt
}

type Album = {
	id: string
	name: string
	count: number
	coverId?: string // user-chosen (setCover), else the newest member — the fallback also covers a chosen item that was deleted or removed
	takenFrom?: number // oldest member's takenAt; absent when empty
	takenTo?: number // newest member's takenAt
	createdAt: number // epoch ms the album was created
}

// States, progress, paths and auto-import settings return with the post-v1
// source types (android, drives, shares)
type Source = {
	id: string
	type: SourceType
	name: string // account name / device name
	lastImportAt?: number // epoch ms; an iPhone's last backup
	createdAt: number // epoch ms the source was added
	stats: {photos: number; videos: number; sizeBytes: number}
	scope?: {mode: ScopeMode; paths: string[]} // the umbrel source: which folders count
}
```

## SubKinds & live pairs

Derived once at import, from the same metadata pass that reads dates and
dimensions; one nullable column. When heuristics overlap the first match wins,
in this order — a photo sphere is ~2:1 equirectangular, so the panorama
heuristic would also match it, and the tag must win:

1. `spherical` — the spherical video box (v1 `Spherical`/`ProjectionType` XML
   or v2 `sv3d`/`proj`) on videos; XMP `GPano:ProjectionType` on photos.
2. `live` — the still of an Apple live pair (below).
3. `screenshot` — `Screenshot*`/`Screen Shot*` file names, or a PNG with no
   camera `Make`/`Model` EXIF.
4. `panorama` — aspect ratio ≥ 2:1.

**Live pairs.** An Apple live photo lands as two files sharing one identifier:
`MakerNotes:ContentIdentifier` on the HEIC/JPEG, and
`com.apple.quicktime.content.identifier` on the MOV (fallback pairing: same
basename + folder + a short MOV). Pair them at import: the still gets
`subKind: 'live'`; the companion MOV is marked as such and excluded from every
listing, count and search — the pair reads as one photo everywhere. `delete`/
`restore`/`deletePermanently` on the still cascade to the companion; favorites
and album membership are still-only. Thumbnails and tint come from the still
like any photo; the motion clip is served at `GET /api/photos/live/:id`. All
playback UX is the frontend's.

## tRPC procedures — `photos.*`

### library

- `summary()` → `{counts: {items, favorites, photos, videos, deleted}, sizeBytes: number, bySubKind: Record<SubKind, number>, bySource: Record<string, number>, months: {year: number, month: number, count: number}[]}`
  — the one call the sidebar, header and search share. All counts except
  `deleted` are over live (non-deleted) items; `items` is the whole library.
  `sizeBytes` = the live originals' total bytes ("48,210 items · 312 GB").
  `bySubKind` carries all four keys, 0 when the library has none.
  `months` is the library calendar: only months that hold items, newest first,
  `month` 1–12 — (year, month) rather than epochs so a server/browser timezone
  difference can't shift a label.

### items

- `list({filter: Filter, cursor?: string, limit: number})` → `{items: Item[], total?: number, nextCursor?: string}`
  — newest first (`takenAt DESC, id ASC`), keyset pagination; the cursor is opaque
  to the client. `limit` up to 1000 (the grid asks for what it is about to draw).
  `total` = the filter's full match count — only needed when `cursor` is absent.
- `get({id, deleted?: boolean})` → `ItemDetail` — NOT_FOUND if missing from the
  selected Home (`false`, default) or Trash (`true`) projection.
- `neighbors({id, filter})` → `{prevId?: string, nextId?: string}` — the item's
  neighbours under the same order and filter as `list`; the lightbox's deep-link case.
- `setFavorite({ids, favorite})` — bulk.
- `delete({ids})` — moves every selected, account-owned Home media copy into the
  account's Files Trash. A live companion moves only when every still in that
  Home projection that references it is selected.
- `restore({ids})` — restores every selected, account-owned Trash media copy
  through Files, using Files' original-path metadata and collision rules.
- `deletePermanently({ids?})` — hard-deletes selected Trash media through Files;
  omitted `ids` resolves and deletes all photos/videos in the account's Trash,
  but never directories or non-media files. Every path is re-authorized at the
  Files boundary and atomically checked against its indexed revision, and
  inaccessible or other-account copies are never touched. Interrupted revision
  claims are recovered from account Home and Trash roots during Files startup.

### albums

- `list()` → `Album[]`
- `create({name, ids?})` → `Album`
- `rename({id, name})`
- `setCover({id, itemId?})` — `itemId` must be a member; omitted = back to the
  derived newest-member cover.
- `delete({id})` — items stay in the library.
- `addItems({id, ids})` / `removeItems({id, ids})` — bulk membership.

Favorites, album membership and covers are keyed by account plus content hash.
They therefore survive Home/Trash moves and a disposable file-index rebuild,
and reconnect when the same bytes are indexed again. An in-place byte edit is a
new hash and deliberately does not inherit old state.

### sources

- `list()` → `Source[]` — always includes the permanent `umbrel` source (identified
  by `type === 'umbrel'`; the UI renames it after the account). iPhones appear here
  when they pair through the mobile app — there is no `add` procedure in v1.
- `update({id, scope?})` → `Source` — partial patch.
- `remove({id, keepItems: boolean})` — unpair an iPhone; `keepItems: false` also
  removes its library copies and index rows. The `umbrel` source refuses removal.

Errors: plain tRPC errors (NOT_FOUND etc.) — the UI shows generic toasts, no
special error-code vocabulary.

## HTTP endpoints

Authorized like Files' HTTP endpoints (dashboard token). The client derives all
of these URLs from item ids — API responses carry no URL fields.

- `GET /api/photos/thumb/:id?s=<192|512|1280>` — generates a missing rendition
  on demand while the background enrichment queue prepares all three sizes
  (videos: from the poster frame). Every rendition preserves aspect ratio,
  scales until its short edge reaches the requested size, and is never cropped,
  padded, stretched or enlarged beyond the oriented source dimensions. EXIF
  auto-orientation runs before resizing. When several renditions are missing,
  ImageMagick writes them from one oriented decode/invocation.

  | `s`  | Scaling           | WebP quality | Serves                                                                                              |
  | ---- | ----------------- | ------------ | --------------------------------------------------------------------------------------------------- |
  | 192  | 192px short edge  | 75           | zoomed-out WebGL mosaic (client crops the centre square itself), filmstrip, instant lightbox seed   |
  | 512  | 512px short edge  | 80           | grid tiles, album covers, lightbox open/close flight placeholder                                    |
  | 1280 | 1280px short edge | 80           | lightbox resting image (original fetched only for zoom/download), video posters, largest grid tiles |

- `GET /api/photos/original/:id` — the original bytes; range requests for video.
  `?download` switches to attachment disposition.
- `GET /api/photos/live/:id` — a live pair's motion clip; only for items with
  `subKind: 'live'`, NOT_FOUND otherwise. Range requests like the original.
- `photos.items.createDownload({ids})` returns a short-lived, account-bound,
  single-use download ticket.
- `GET /api/photos/download?ticket=…` — one selected item is returned as a
  file attachment; several are returned as a flat zip stream. Every item is
  re-authorized for the ticket's account when the HTTP request is handled.
- `POST /api/photos/upload?name=IMG_1234.jpg&album=<id>` — body = the bytes, one
  file per request; `album` optional, validated before the bytes stream, files the
  item on success. The complete hidden temporary file is BLAKE3-hashed and
  checked for an account-local duplicate before it is published into the
  library; duplicate bytes are discarded without creating a visible pathname.
  2xx answers `{status: 'imported' | 'duplicate'}`, and the upload island reports
  "N added · M already in your library".
  Unsupported file types → 415 (the UI filters its pickers too) so nothing is
  silently swallowed.

## Events

- `photos:change` on the event bus — emitted after library mutations,
  filesystem discovery, and enrichment progress. No payload; the UI debounces
  one second and refetches what it is showing, so bursts are cheap.
