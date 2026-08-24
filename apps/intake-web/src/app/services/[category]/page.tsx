import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PUBLIC_SERVICE_CATEGORIES, SITE_URL, serviceCategoryUrl, serviceSkillUrl } from "../../discovery";

type Props = {
  params: Promise<{ category: string }>;
};

function findCategory(slug: string) {
  return PUBLIC_SERVICE_CATEGORIES.find((category) => category.slug === slug);
}

export async function generateStaticParams() {
  return PUBLIC_SERVICE_CATEGORIES.map((category) => ({ category: category.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: slug } = await params;
  const category = findCategory(slug);
  if (!category) return {};
  return {
    title: `${category.name} through ClueXP`,
    description: category.description,
    alternates: {
      canonical: serviceCategoryUrl(category.slug)
    }
  };
}

export default async function ServiceCategoryPage({ params }: Props) {
  const { category: slug } = await params;
  const category = findCategory(slug);
  if (!category) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: category.name,
    serviceType: category.serviceType,
    url: serviceCategoryUrl(category.slug),
    description: category.description,
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: `${category.name} request types`,
      itemListElement: category.skills.map((skill) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: skill.name,
          serviceType: skill.code,
          url: serviceSkillUrl(skill.categorySlug, skill.slug),
          description: skill.description
        }
      }))
    }
  };

  return (
    <main className="discovery-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <p className="kicker">Service category</p>
      <h1 className="message">{category.name} through ClueXP</h1>
      <p className="support">{category.description}</p>

      <section className="stack">
        <div className="panel">
          <h2>What ClueXP can expose to agents</h2>
          <p>
            Agents and approved API clients can list services, check coverage, create a request after
            explicit confirmation, and read safe status/tracking. Dispatch authorization and cancellation
            are not exposed in the first agent preview.
          </p>
        </div>
        <div className="panel">
          <h2>{category.name} request types</h2>
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
        </div>
      </section>
    </main>
  );
}
