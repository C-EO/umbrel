# App Store

The umbrelOS App Store: an OS-native storefront over the locally synced app
registry, optionally decorated by editorial content from apps.umbrel.com.

## Local truth, remote taste

The locally synced registry (`appStore.registry` via `AvailableAppsProvider`)
decides which apps exist, their current versions, compatibility, dependencies,
and every action. The remote v3 API (`data/storefront-query.ts`,
`data/releases.ts`) may only decorate or order apps that already exist locally:

- Every remote app id is resolved against the local registry; unknown ids are
  silently dropped (`data/storefront.ts` → `resolveStorefront`).
- Sections without enough locally available content disappear entirely.
- `updatedAt` metadata is applied only when the remote entry describes the
  exact version the local registry offers; `createdAt` is version-insensitive.
- Release history is accepted only for the same app id and current version,
  and never shows releases newer than what this device can install
  (`data/releases.ts` → `reconcileReleases`).
- A failed, slow (>3s), blocked, malformed, or outdated remote response is
  treated exactly like having no remote data: the complete local store renders
  with no spinner, no error card, and no toast. Discover then hands over to
  All apps as the landing page, and the feed is retried in the background.
- Pages wait for the feed's first attempt (`hooks/use-storefront.ts`) so
  Discover composes once — editorial sections and catalog together — rather
  than the catalog appearing alone with the sections landing on top of it. A
  feed that has already failed is never waited for again, and the query keeps
  its data cached for the session so reopening the store is instant.

Search (`data/search.ts`) is local-only and never triggers a network request.
Date-based sorting (`data/catalog.ts`) is offered only while remote metadata
provides usable dates — options are hidden, not disabled, offline.

## v3 API compatibility rules

The feed schema (`data/storefront.ts`) is versioned with `schemaVersion: 1`
and a deliberately tiny section vocabulary: `app-list` (grid/rail),
`spotlight` (one section of banners — each just an app id and its artwork,
since the composition is the image), and `category-feature`. Unknown future section types and
individually malformed sections are dropped without failing the feed, so the
API can add new types without breaking released clients. Artwork must be
hosted on the same origin as the API itself. Curated content is edited in
`private-apps-umbrel-com/lib/umbrelos-v3.js` — add or reorder sections there;
this client needs no changes as long as the section uses the existing types.

## Structure

- `routes.tsx` — route objects, spread into `router.tsx` under `SheetLayout`
- `index.tsx` — store shell: title, search, updates chip, category rail
- `components/` — pages (`discover`, `category`, `app-page`) and sections
- `data/` — pure schemas, selectors, and query definitions (unit-tested)
- `hooks/` — thin bindings of the pure data layer to providers/queries
- `providers/store-actions.tsx` — shared install/update/open mutations plus
  the dialogs they can raise, so every app card offers a working action
  button without mounting per-card state

On desktop the app page hero (`components/app-page/app-hero.tsx`) pins to the
top of the sheet and collapses with the scroll position itself — icon and
name scale into a compact bar, then a blurred surface pops in underneath.

Pages compose in with the store's shared reveal (`storeRevealClass` /
`storeRevealDelay` in `constants.ts`, keyframes in `index.css`): sections
rise gently out of a blur, each a small beat behind the last, and the shell
keys its content by page identity so switching categories replays it. Inside
the collapsing hero use the soft (blur-and-fade only) variant — a transform
there would fight the scroll-driven motion values, and an in-flight transform
on any ancestor of the sticky wrapper would unpin it.

The install/open/dependency flow (`InstallButtonConnected`,
`SelectDependenciesDialog`, `OSUpdateRequiredDialog`) and the update hooks
(`useAppsWithUpdates`, `useUpdateAllApps`) are shared with the rest of the OS
and live outside the feature. Community app stores reuse this feature's grid
and app-page composition from `routes/community-app-store/`.
