# Region directory provenance

The immutable `2026-09-11` snapshot contains countryInfo.txt, admin1CodesASCII.txt, admin2Codes.txt and the GeoNames readme. `manifest.json` records source URLs, download timestamp, byte sizes, SHA-256 hashes, license and modifications. Data attribution: GeoNames, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [source exports](https://download.geonames.org/export/dump/). Attribution is also shown in Settings → About the directory.

Coverage: 250 source countries/territories, 3,865 first-level administrative areas and 3,143 US counties or county equivalents. Retired CS and AN are excluded according to the source notes. Non-US second-level areas are deliberately not promoted to broad localities without a separate coverage review; use a first-level area or country. This is a source directory, not a statement of sovereignty, a geocoder, or an assurance of current administrative boundaries.

Internal IDs are `gn:<geonameid>`, plus `world`. Source administrative codes remain separate and are not assumed to be ISO codes. No coordinates, populations, phone codes or personal information are included in the generated region rows. SQL preserves source code/version/name mappings, rejects orphans/duplicate IDs and generates each ancestor including self. Initial migration includes 7,259 regions and 24,668 ancestor links.

Reproduce from repository root:

```
node tools/regions/build.mjs 2026-09-11
node --test tools/regions/regions.test.mjs
```

Downloading a new dated snapshot uses `node tools/regions/download.mjs YYYY-MM-DD`; it refuses to overwrite an existing snapshot. The initial generator writes the initial snapshot migration, so future updates require a separate reviewed migration rather than rerunning it over deployed history. Preserve referenced IDs and ancestor paths; retire unavailable regions using `active=false` so the resolver can return a valid broader ancestor. Every update must retain license/source attribution and exact hashes. No third-party service is called while logging a check-in.
