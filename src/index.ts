#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string; name: string };

// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

// Drop undefined values so optional inputs are not sent to the actor.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// How long the actor run itself is allowed to take, in seconds. The suite's
// slowest measured run on 2026-09-22 was 152 s on a seven platform search, so
// 1800 s is roughly twelve times that: headroom for a slow day without letting a
// hung run bill indefinitely.
const ACTOR_RUN_TIMEOUT_SECS = 1800;

// How long this wrapper waits for that run, in milliseconds. The actor's own
// timeout plus two minutes, so the run's own TIMED-OUT status is what the
// caller sees rather than the wrapper giving up first and reporting nothing.
const WRAPPER_WAIT_MS = (ACTOR_RUN_TIMEOUT_SECS + 120) * 1000;
const POLL_INTERVAL_MS = 3000;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "ABORTING"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// START AND POLL, NOT RUN-SYNC. Apify's synchronous endpoints carry a platform
// ceiling of 300 seconds on the HTTP wait itself and answer 408 past it whatever
// the timeout parameter says, so a long run reads as a timeout even though the
// actor goes on to finish. Starting the run, polling it to a terminal status and
// then reading the dataset is the only way to wait as long as the actor needs.
//
// The token is read here rather than at module load, so the tool registers
// unconditionally and a server started without APIFY_TOKEN still advertises its
// capabilities instead of reporting none.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  const headers = {
    Authorization: `Bearer ${APIFY_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const httpError = async (response: Response): Promise<string> => {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }
    switch (response.status) {
      case 400:
        return `The ${actorLabel} run was rejected as invalid input.${detail}`;
      case 401:
        return "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
      case 402:
        return "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
      default:
        return `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
  };

  // 1. Start the run.
  let started: Response;
  try {
    started = await fetch(
      `https://api.apify.com/v2/acts/${actorPath}/runs?timeout=${ACTOR_RUN_TIMEOUT_SECS}`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }
  if (!started.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(started) }] };
  }

  let run: { id?: string; status?: string; defaultDatasetId?: string };
  try {
    run = ((await started.json()) as { data?: typeof run }).data ?? {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned a response that could not be parsed: ${message}` }] };
  }
  const runId = run.id;
  if (!runId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned no run id, so there is nothing to wait for.` }] };
  }

  // 2. Poll to a terminal status.
  const deadline = Date.now() + WRAPPER_WAIT_MS;
  let status = run.status ?? "READY";
  let datasetId = run.defaultDatasetId;
  while (!TERMINAL.has(status)) {
    if (Date.now() >= deadline) {
      return {
        isError: true,
        content: [{ type: "text", text: `The ${actorLabel} run ${runId} was still ${status} after ${Math.round(WRAPPER_WAIT_MS / 1000)} seconds and this call stopped waiting. The run itself is still on Apify: read it at https://console.apify.com/actors/runs/${runId}` }],
      };
    }
    await sleep(POLL_INTERVAL_MS);
    let poll: Response;
    try {
      poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: `Lost contact with the Apify API while waiting for ${actorLabel} run ${runId}: ${message}` }] };
    }
    if (!poll.ok) {
      return { isError: true, content: [{ type: "text", text: await httpError(poll) }] };
    }
    const body = (await poll.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    status = body.data?.status ?? status;
    datasetId = body.data?.defaultDatasetId ?? datasetId;
  }

  // 3. A run that did not succeed is a failure the caller must see, never an
  // empty success. Surfacing it here is what keeps a crashed run from reading
  // as "no results found".
  if (status !== "SUCCEEDED") {
    return {
      isError: true,
      content: [{ type: "text", text: `The ${actorLabel} run did not succeed (run ID: ${runId}, status: ${status}).` }],
    };
  }
  if (!datasetId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run ${runId} succeeded but reported no dataset, so there is nothing to return.` }] };
  }

  // 4. Read the dataset.
  let ds: Response;
  try {
    ds = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?format=json`, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not read the ${actorLabel} dataset: ${message}` }] };
  }
  if (!ds.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(ds) }] };
  }

  let items: unknown;
  try {
    items = await ds.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run returned a response that could not be parsed: ${message}` }] };
  }

  if (!Array.isArray(items)) {
    const asObj = items as { error?: { type?: string; message?: string } };
    const detail = asObj?.error?.message
      ? `${asObj.error.message}`
      : JSON.stringify(items);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run did not return a dataset. ${detail}` }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}

const server = new McpServer({
  name: "mamba-creator-finder",
  version: pkg.version,
});

// Influencer Finder (immutable actor ID tpkedmloIIWtXx6sg)
server.registerTool(
  "find_influencers",
  {
    title: "Find Influencers by Keyword or Niche",
    description:
      "Searches TikTok, Instagram, YouTube, Pinterest, Twitch, Threads, and podcasts for creators matching your keywords or one of eight curated niche keyword sets, then filters them to a follower range. Returns one flat row per creator per platform with handle, profile URL, display name, follower count, the search that found them, a stable creator_id, and similar creators from the same keyword cluster. Discovery only: it does not read bios, emails, or link in bio pages, which is what Influencer Profile Scraper and Link in Bio Scraper and Newsletter Detector do. Every row carries row_status and error_reason, so an absence is readable rather than silent. Charges $0.001 per run plus $0.007 per creator returned; a search that returns nothing charges the run start only. Contributes the public records it finds to a shared creator and agency pool that all users of this actor read from, so a later run reads what this one found; `contribute_to_shared_pool` is on by default and turning it off leaves the run reading the pool and writing nothing. Only public data already in the returned rows is contributed, nothing from your Apify account or your input, and a contribution is not charged. Requires an APIFY_TOKEN and consumes Apify credits. Read only.",
    annotations: {
      title: "Find Influencers by Keyword or Niche",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
    keywords: z.array(z.string()).optional().describe("Search phrases, one per line, for example \"budget travel\" or \"meal prep coach\". Each keyword is searched on each platform. Use `niche` instead to load a curated keyword set."),
    niche: z.enum(["custom", "personal_finance", "business_marketing", "health_fitness", "beauty_skincare", "parenting_family", "food_cooking", "travel", "tech_ai"]).optional().describe("Loads a curated set of search keywords for the niche (about 60 per niche, measured in the September 2026 pre-research). `max_keywords_per_niche` caps how many are used. Leave as custom to search only your keywords. Default: \"custom\"."),
    max_keywords_per_niche: z.number().int().optional().describe("How many keywords from the niche set to search. 1 to 60. Default: 10."),
    platforms: z.array(z.enum(["tiktok", "instagram", "youtube", "pinterest", "twitch", "threads", "podcast"])).optional().describe("Which platforms to search, and which platforms a bare @handle is looked up on. A full profile URL carries its own platform and ignores this. Supported: TikTok, Instagram, YouTube, Pinterest, Twitch, Threads, and podcasts. Not X, not Facebook pages, not LinkedIn."),
    max_creators_per_keyword: z.number().int().optional().describe("Cap per search. Search engines honor the site: filter for the first page or two only, so 20 to 30 per keyword with more keywords beats deep paging. Default: 20."),
    max_creators: z.number().int().optional().describe("Hard cap on rows returned, so a broad niche cannot run away. Default: 200."),
    follower_min: z.number().int().optional().describe("Drop creators whose follower count is known and below this. A creator whose count the search did not show is kept, so a later profile read can fill it. Default: 5000."),
    follower_max: z.number().int().optional().describe("Drop creators whose follower count is known and above this. Default: 500000."),
    us_only: z.boolean().optional().describe("Launch scope is US creators. Discovery carries no country signal, so country_guess is null on every row of this actor and this field changes nothing here. It is accepted so the same input runs unchanged on the Influencer Lead List Builder, where it acts at the profile stage. Default: true."),
    batch_size: z.number().int().optional().describe("Rows fetched at once. Leave empty for the measured per platform default; the measurement is in the README. Higher is faster and, above the measured point, loses rows."),
    // Shared pool toggle (wo-influencer-newsletter-agency-pool-exchange-2026-09-22, Track 4).
    // The actor input field is Track 3's; this mirror exists so an MCP caller can turn the
    // contribution off. Do not publish this wrapper before the actor build that carries the
    // field is live, or the actor is sent an input property its schema does not have.
    contribute_to_shared_pool: z.boolean().optional().describe("On by default. Contributes the public records this run finds to a shared creator and agency pool that all users of this actor read from, so a later run reads what this one found. Only public data already in the returned rows is sent, never your Apify account, your input list, or your API keys, and a contribution is not charged. Set false to read the pool and write nothing. Default: true."),
    },
  },
  async (args) =>
    runActor("tpkedmloIIWtXx6sg", "Influencer Finder", compact(args as Record<string, unknown>)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
