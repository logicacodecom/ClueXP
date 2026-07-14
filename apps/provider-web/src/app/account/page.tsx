"use client";

import { AccountSettings } from "@cluexp/app-core";
import { AppFrame } from "../frame";

export default function AccountPage() {
  return (
    <AppFrame>
      <AccountSettings className="max-w-3xl" />
    </AppFrame>
  );
}
