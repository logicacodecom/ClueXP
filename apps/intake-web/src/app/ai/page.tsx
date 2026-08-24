import type { Metadata } from "next";
import {
  PUBLIC_API_PATHS,
  PUBLIC_SERVICE_SKILLS,
  SITE_URL,
  WITHHELD_AGENT_TOOLS,
  serviceSkillUrl
} from "../discovery";

export const metadata: Metadata = {
  title: "ClueXP for AI Agents and Service Discovery",
  description:
    "Machine-readable ClueXP service discovery, public API links, and current limits for AI assistants and search systems.",
  alternates: {
    canonical: `${SITE_URL}/ai`
  }
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "ClueXP",
  url: SITE_URL,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "ClueXP is a dispatch and intake platform for urgent physical-access services, partner API intake, coverage checks, and privacy-minimized service request tracking.",
  offers: PUBLIC_SERVICE_SKILLS.map((skill) => ({
    "@type": "Offer",
    itemOffered: {
      "@type": "Service",
      name: skill.name,
      serviceType: skill.code,
      category: skill.category,
      description: skill.description
    }
  })),
  potentialAction: [
    {
      "@type": "CheckAction",
      name: "Check ClueXP service coverage",
      target: `${SITE_URL}/v1/coverage-checks`
    },
    {
      "@type": "ReserveAction",
      name: "Create a ClueXP service request",
      target: `${SITE_URL}/v1/service-requests`
    }
  ]
};

export default function AiDiscoveryPage() {
  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "48px 20px 80px", lineHeight: 1.55 }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <p className="kicker">AI and service discovery</p>
      <h1 className="message">ClueXP public agent surface</h1>
      <p className="support">
        ClueXP helps customers and approved partners create urgent access-service requests, check service
        coverage, and read privacy-minimized request status. This page is written for AI assistants,
        search crawlers, and integration builders.
      </p>

      <section className="stack" aria-labelledby="status-heading">
        <div className="panel">
          <h2 id="status-heading">Current status</h2>
          <p>
            The public <code>/v1</code> API and a local MCP adapter exist for internal preview. ClueXP is
            not yet publicly listed in ChatGPT, Claude, Gemini, Siri, or any agent marketplace. Hosted
            partner discovery pages are not published yet.
          </p>
        </div>

        <div className="panel">
          <h2>Machine-readable resources</h2>
          <ul>
            <li><a href="/llms.txt">/llms.txt</a> — AI-readable summary and crawl guidance.</li>
            <li><a href="/openapi-v1.json">/openapi-v1.json</a> — public <code>/v1</code> OpenAPI snapshot.</li>
            <li><a href="/sitemap.xml">/sitemap.xml</a> — crawlable site map.</li>
            <li><a href="/services">/services</a> — crawlable service discovery index.</li>
            <li><a href="/partners">/partners</a> — hosted partner discovery entry point.</li>
          </ul>
        </div>

        <div className="panel">
          <h2>Agent-safe public API surface</h2>
          <ul>
            {PUBLIC_API_PATHS.map((path) => (
              <li key={path}><code>{path}</code></li>
            ))}
          </ul>
          <p>
            Creating a service request requires explicit user confirmation. The first MCP preview does not
            expose tools that can authorize dispatch or cancel work.
          </p>
        </div>

        <div className="panel">
          <h2>Withheld from first agent preview</h2>
          <ul>
            {WITHHELD_AGENT_TOOLS.map((path) => (
              <li key={path}><code>{path}</code></li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>Services currently described for discovery</h2>
          <ul>
            {PUBLIC_SERVICE_SKILLS.map((skill) => (
              <li key={skill.code}>
                <strong>{skill.name}</strong> — <code>{skill.code}</code>. {skill.description}
                {" "}<a href={serviceSkillUrl(skill.categorySlug, skill.slug).replace(SITE_URL, "")}>Service page</a>.
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h2>Guidance for AI assistants</h2>
          <ul>
            <li>Use the OpenAPI snapshot for exact request/response shapes.</li>
            <li>Do not claim live provider availability unless an official coverage check confirms it.</li>
            <li>Do not infer or expose technician identity before the public tracking API allows it.</li>
            <li>Do not invent hosted partners; partner-specific discovery needs published partner pages.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
