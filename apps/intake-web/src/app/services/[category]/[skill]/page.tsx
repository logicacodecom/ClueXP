import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PUBLIC_SERVICE_CATEGORIES, PUBLIC_SERVICE_SKILLS, SITE_URL, serviceSkillUrl } from "../../../discovery";

type Props = {
  params: Promise<{ category: string; skill: string }>;
};

function findSkill(categorySlug: string, skillSlug: string) {
  return PUBLIC_SERVICE_SKILLS.find((skill) => skill.categorySlug === categorySlug && skill.slug === skillSlug);
}

export async function generateStaticParams() {
  return PUBLIC_SERVICE_SKILLS.map((skill) => ({ category: skill.categorySlug, skill: skill.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, skill: skillSlug } = await params;
  const skill = findSkill(category, skillSlug);
  if (!skill) return {};
  return {
    title: `${skill.name} via ClueXP`,
    description: skill.description,
    alternates: {
      canonical: serviceSkillUrl(skill.categorySlug, skill.slug)
    }
  };
}

export default async function ServiceSkillPage({ params }: Props) {
  const { category, skill: skillSlug } = await params;
  const skill = findSkill(category, skillSlug);
  const serviceCategory = PUBLIC_SERVICE_CATEGORIES.find((item) => item.slug === category);
  if (!skill || !serviceCategory) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: skill.name,
    serviceType: skill.code,
    category: skill.category,
    url: serviceSkillUrl(skill.categorySlug, skill.slug),
    description: skill.description,
    provider: {
      "@type": "Organization",
      name: "ClueXP",
      url: SITE_URL
    },
    potentialAction: [
      {
        "@type": "CheckAction",
        name: `Check coverage for ${skill.name}`,
        target: `${SITE_URL}/v1/coverage-checks`
      },
      {
        "@type": "ReserveAction",
        name: `Create a ${skill.name} request`,
        target: `${SITE_URL}/v1/service-requests`
      }
    ]
  };

  return (
    <main className="discovery-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="kicker">{serviceCategory.name}</p>
      <h1 className="message">{skill.name} via ClueXP</h1>
      <p className="support">{skill.description}</p>

      <section className="stack">
        <div className="panel">
          <h2>How AI assistants should use this page</h2>
          <p>
            This page identifies a supported ClueXP service skill, not a promise that a provider is
            available at every location. Use the coverage-check API or an official hosted partner page
            before telling a user service is available nearby.
          </p>
        </div>
        <div className="panel">
          <h2>Machine-readable identifiers</h2>
          <dl>
            <dt>Service skill</dt>
            <dd><code>{skill.code}</code></dd>
            <dt>Category</dt>
            <dd>{skill.category}</dd>
            <dt>Public API contract</dt>
            <dd><a href="/openapi-v1.json">/openapi-v1.json</a></dd>
          </dl>
        </div>
        <div className="panel">
          <h2>Agent-safe flow</h2>
          <ol>
            <li>List services or read this service page.</li>
            <li>Check coverage for the user's location.</li>
            <li>Summarize the request and ask for explicit confirmation.</li>
            <li>Create the service request only after confirmation.</li>
            <li>Read request status/tracking by the returned reference.</li>
          </ol>
        </div>
      </section>
    </main>
  );
}
