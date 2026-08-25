import {
  PUBLIC_API_PATHS,
  PUBLIC_SERVICE_CATEGORIES,
  PUBLIC_SERVICE_SKILLS,
  SITE_URL,
  WITHHELD_AGENT_TOOLS,
  serviceCategoryUrl,
  serviceSkillUrl
} from "../discovery";

export const dynamic = "force-static";

export function GET() {
  const body = `# ClueXP

> ClueXP is a dispatch and intake platform for urgent physical-access services. The current public surface focuses on locksmith-style access help, partner/API intake, service coverage checks, request creation, and privacy-minimized request status/tracking.

Base URL: ${SITE_URL}

## AI and agent integration status

- Public API: approved client contract exists under /v1.
- MCP adapter: controlled-preview package exists in the repository; it is not publicly listed or connected to marketplace agent platforms yet.
- Production marketplace status: not submitted/listed for ChatGPT, Claude, Gemini, Siri, or other public agent stores.
- Mutating agent calls require explicit user confirmation before service-request creation, dispatch authorization, or cancellation.

## Human-readable pages

- ${SITE_URL}/ai — AI/search discovery page for ClueXP capabilities, limits, and integration links.
- ${SITE_URL}/services — public service discovery index.
- ${PUBLIC_SERVICE_CATEGORIES.map((category) => `${serviceCategoryUrl(category.slug)} — ${category.name}.`).join("\n- ")}
- ${SITE_URL}/partners — hosted partner discovery entry point. No partner pages are published yet unless listed there.

## Machine-readable resources

- ${SITE_URL}/openapi-v1.json — public /v1 OpenAPI snapshot.
- ${SITE_URL}/sitemap.xml — crawlable site map.
- ${SITE_URL}/robots.txt — crawler policy.

## Public API endpoints in the first agent-safe surface

${PUBLIC_API_PATHS.map((path) => `- ${path}`).join("\n")}

## Explicitly withheld from public/agent tools

${WITHHELD_AGENT_TOOLS.map((path) => `- ${path}`).join("\n")}

## Service skills currently described for discovery

${PUBLIC_SERVICE_SKILLS.map((skill) => `- ${skill.code}: ${skill.name} (${skill.category}) — ${skill.description} URL: ${serviceSkillUrl(skill.categorySlug, skill.slug)}`).join("\n")}

## Integration notes for AI systems

- Use /openapi-v1.json as the source of truth for request and response shapes.
- Do not assume ClueXP can dispatch a technician from ordinary web crawling alone.
- Do not claim ClueXP is available in a user location unless a coverage check or official ClueXP page confirms it.
- Do not invent partner availability. Hosted partner discovery requires partner-specific published pages or API-provided partner metadata.
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600"
    }
  });
}
