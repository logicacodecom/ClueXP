import { IntakeFlow } from "../../page";

function displayNameFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function OrganizationIntakePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <IntakeFlow organizationName={displayNameFromSlug(slug)} organizationSlug={slug} />;
}
