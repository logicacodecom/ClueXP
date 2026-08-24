import type { Metadata } from "next";
import {
  PUBLIC_SERVICE_CATEGORIES,
  PUBLIC_SERVICE_SKILLS,
  SITE_URL,
  serviceCategoryUrl,
  serviceSkillUrl
} from "../discovery";

export const metadata: Metadata = {
  title: "ClueXP Service Discovery",
  description: "Crawlable ClueXP service categories and public API discovery for urgent access-service requests.",
  alternates: {
    canonical: `${SITE_URL}/services`
  }
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "ClueXP service discovery",
  url: `${SITE_URL}/services`,
  about: PUBLIC_SERVICE_SKILLS.map((skill) => ({
    "@type": "Service",
    name: skill.name,
    serviceType: skill.code,
    category: skill.category,
    url: serviceSkillUrl(skill.categorySlug, skill.slug),
    description: skill.description
  }))
};

export default function ServicesPage() {
  return (
    <main className="discovery-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="kicker">Service discovery</p>
      <h1 className="message">ClueXP service pages for AI and search</h1>
      <p className="support">
        Crawlable descriptions of the service requests ClueXP can represent through its public
        intake and agent-safe API surface. Coverage and availability must still be checked through
        official ClueXP APIs or published partner pages.
      </p>

      <section className="stack">
        {PUBLIC_SERVICE_CATEGORIES.map((category) => (
          <article className="panel" key={category.slug}>
            <h2><a href={serviceCategoryUrl(category.slug).replace(SITE_URL, "")}>{category.name}</a></h2>
            <p>{category.description}</p>
            <ul>
              {category.skills.map((skill) => (
                <li key={skill.code}>
                  <a href={serviceSkillUrl(skill.categorySlug, skill.slug).replace(SITE_URL, "")}>
                    {skill.name}
                  </a>{" "}
                  — <code>{skill.code}</code>. {skill.description}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}
