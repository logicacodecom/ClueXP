import { TechnicianAssignment } from "@cluexp/console-ui";
import { AppFrame } from "../../frame";

export default async function CandidatesPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <AppFrame><TechnicianAssignment jobId={jobId} mode="org" /></AppFrame>;
}
