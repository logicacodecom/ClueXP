import { jobById } from "@cluexp/api-client";
import { ActiveJobHeader, AppFrame, ChatPreview, Pill, Screen, Section, icons } from "@/components/mobile";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = jobById(id) ?? jobById("JOB-D-2301");
  if (!job) return null;
  return (
    <AppFrame title="Customer Chat">
      <Screen>
        <ActiveJobHeader job={job} stage="Chat" />
        <Section action={<Pill tone="success" icon={icons.ShieldCheck}>Masked</Pill>} title="Customer chat">
          <ChatPreview full />
        </Section>
      </Screen>
    </AppFrame>
  );
}
