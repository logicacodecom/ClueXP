import { redirect } from "next/navigation";

export default async function NavigatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/jobs/${id}`);
}
