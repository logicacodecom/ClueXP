import { AppFrame, CallPanel, Screen } from "@/components/mobile";

export default function CallPage() {
  return (
    <AppFrame title="Masked Call">
      <Screen>
        <CallPanel />
      </Screen>
    </AppFrame>
  );
}
