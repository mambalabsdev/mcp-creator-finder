# Influencer Finder MCP Server

[![Smithery](https://smithery.ai/badge/mambabuilt/mcp-creator-finder)](https://smithery.ai/servers/mambabuilt/mcp-creator-finder) [![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-creator-finder/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-creator-finder) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-creator-finder%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-creator-finder&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-creator-finder)](https://www.npmjs.com/package/@mambalabsdev/mcp-creator-finder) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-creator-finder)](https://www.npmjs.com/package/@mambalabsdev/mcp-creator-finder) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-creator-finder)](https://github.com/mambalabsdev/mcp-creator-finder/blob/main/LICENSE) [![mcpservers.org](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/mambalabsdev/mcp-creator-finder)

MCP server for the Mamba Labs [Influencer Finder](https://apify.com/mambalabs/creator-finder) actor on Apify.

Keywords or a curated niche in, influencer handles out, one flat row per creator per platform.

## Install

```bash
npx -y @mambalabsdev/mcp-creator-finder
```

### Claude Desktop

```json
{
  "mcpServers": {
    "mamba-creator-finder": {
      "command": "npx",
      "args": ["-y", "@mambalabsdev/mcp-creator-finder"],
      "env": { "APIFY_TOKEN": "your-apify-token" }
    }
  }
}
```

Get an Apify token at [console.apify.com/account/integrations](https://console.apify.com/account/integrations).

## Tool

### `find_influencers`

Find influencers by keyword or niche across seven creator platforms, with follower counts.

| Input | Type | Required | Notes |
| --- | --- | --- | --- |
| `keywords` | array | no | Search phrases, one per line, for example "budget travel" or "meal prep coach". Each keyword is searched on each platform. Use `niche` instead to load a curated keyword set. |
| `niche` | string | no | Loads a curated set of search keywords for the niche (about 60 per niche, measured in the September 2026 pre-research). `max_keywords_per_niche` caps how many are used. Leave as custom to search only your keywords. Default `"custom"`. |
| `max_keywords_per_niche` | integer | no | How many keywords from the niche set to search. 1 to 60. Default `10`. |
| `platforms` | array | no | Which platforms to search, and which platforms a bare @handle is looked up on. A full profile URL carries its own platform and ignores this. Supported: TikTok, Instagram, YouTube, Pinterest, Twitch, Threads, and. |
| `max_creators_per_keyword` | integer | no | Cap per search. Search engines honor the site: filter for the first page or two only, so 20 to 30 per keyword with more keywords beats deep paging. Default `20`. |
| `max_creators` | integer | no | Hard cap on rows returned, so a broad niche cannot run away. Default `200`. |
| `follower_min` | integer | no | Drop creators whose follower count is known and below this. A creator whose count the search did not show is kept, so a later profile read can fill it. Default `5000`. |
| `follower_max` | integer | no | Drop creators whose follower count is known and above this. Default `500000`. |
| `us_only` | boolean | no | Launch scope is US creators. Discovery carries no country signal, so country_guess is null on every row of this actor and this field changes nothing here. It is accepted so the same input runs unchanged on the. Default `true`. |
| `batch_size` | integer | no | Rows fetched at once. Leave empty for the measured per platform default; the measurement is in the README. Higher is faster and, above the measured point, loses rows. |
| `contribute_to_shared_pool` | boolean | no | On by default. Contributes the public records this run finds to a shared creator and agency pool that all users of this actor read from. Only public data already in the returned rows is sent, and a contribution is not charged. Set false to read the pool and write nothing. Default `true`. |

Nothing is required. Influencer Finder answers a run with no usable input with a row carrying `row_status` and `error_reason` rather than failing, and the tool mirrors that.

## Pricing

Influencer Finder is pay per event on Apify. Every price below is flat across the FREE, BRONZE, SILVER, and GOLD tiers.

| Event | Charged for | Price | Fires when |
| --- | --- | ---: | --- |
| `actor-start` | Actor start | $0.001 | Once per run, on start. Covers the run overhead. |
| `creator-found` | Creator found | $0.007 | Once per creator row returned by keyword or niche discovery with a handle and a profile URL. A search that returns nothing charges nothing. |

## Reading the output

Every row carries `row_status` and `error_reason`. A creator the actor could not read comes back as a row saying why, not as a gap in the list, so an absence is readable rather than inferred. Filter on `row_status` before loading a table.

## What this actor shares

The run contributes the records it finds to a shared creator and agency pool that all users of this actor read from. What one run finds, the next run can read.

The toggle is `contribute_to_shared_pool`. It is on by default. Set it to false and the run still reads the pool and writes nothing to it.

**What this actor contributes.** The creator ID, platform, and handle of every creator it finds. No profile detail, because this actor reads none.

**Only public data that is already in your own output.** Every field written to the pool is a field this run returned to you, read from a page the platform or the creator publishes to anyone without a login. Nothing from your Apify account, your input list, your API keys, or your own notes is sent. A contribution never deletes anything from the pool.

**What a contribution is labeled with.** The actor ID, the run ID, the pool key issued to the actor build, and a hash of the calling IP address, used for the rate limit and nothing else. Your Apify account and your user ID are not recorded.

**Contributing is free.** No event is charged for a write to the pool. If the pool is unreachable the run finishes as normal, the rows are dropped, and the run log says so.

## Actor

Actor ID `tpkedmloIIWtXx6sg`. The wrapper calls the actor by that immutable ID rather than by its Store slug, so a Store rename never breaks it.

## Suite

| Actor | Actor ID | MCP server |
| --- | --- | --- |
| [Influencer Finder](https://apify.com/mambalabs/creator-finder) | `tpkedmloIIWtXx6sg` | [`@mambalabsdev/mcp-creator-finder`](https://www.npmjs.com/package/@mambalabsdev/mcp-creator-finder) |
| [Influencer Profile Scraper](https://apify.com/mambalabs/creator-profile-reader) | `EqEnklDVMIcB1V499` | [`@mambalabsdev/mcp-creator-profile-reader`](https://www.npmjs.com/package/@mambalabsdev/mcp-creator-profile-reader) |
| [Link in Bio Scraper and Newsletter Detector](https://apify.com/mambalabs/link-in-bio-newsletter-checker) | `OorucdheTIgu7RFzK` | [`@mambalabsdev/mcp-link-in-bio-newsletter-checker`](https://www.npmjs.com/package/@mambalabsdev/mcp-link-in-bio-newsletter-checker) |
| [Influencer Change Monitor](https://apify.com/mambalabs/creator-change-monitor) | `d2VVgahNL6UmcLkhg` | [`@mambalabsdev/mcp-creator-change-monitor`](https://www.npmjs.com/package/@mambalabsdev/mcp-creator-change-monitor) |
| [Influencer Lead List Builder](https://apify.com/mambalabs/creator-lead-list-all-in-one) | `KnmByszcv135yM30G` | [`@mambalabsdev/mcp-creator-lead-list-all-in-one`](https://www.npmjs.com/package/@mambalabsdev/mcp-creator-lead-list-all-in-one) |

Built by [Mamba Labs](https://mambabuilt.com).
