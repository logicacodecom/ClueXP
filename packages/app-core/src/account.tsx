"use client";

import { useEffect, useState } from "react";
import { LanguageSettings, useLocale } from "./locale";
import { sessionRequest, useSession } from "./session";

const fieldClass =
  "min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground";
const sectionClass = "rounded-md border border-border bg-card p-6";
const buttonClass =
  "min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50";

export function AccountSettings({ className }: { className?: string }) {
  const { t } = useLocale();
  const { loading, refresh, session } = useSession();

  const [profile, setProfile] = useState({ display_name: "", email: "", phone: "" });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  const [password, setPassword] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    setProfile({
      display_name: session.user.display_name ?? "",
      email: session.user.email ?? "",
      phone: session.user.phone ?? ""
    });
  }, [session]);

  async function saveProfile() {
    setProfileBusy(true);
    setProfileMessage(null);
    try {
      const payload: Record<string, string> = {};
      if (profile.display_name.trim()) payload.display_name = profile.display_name.trim();
      if (profile.email.trim()) payload.email = profile.email.trim();
      if (profile.phone.trim()) payload.phone = profile.phone.trim();
      await sessionRequest("/api/account", { method: "PATCH", body: JSON.stringify(payload) });
      await refresh();
      setProfileMessage(t("saved"));
    } catch (cause) {
      setProfileMessage(cause instanceof Error ? cause.message : "Unable to save profile");
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword() {
    setPasswordMessage(null);
    if (password.new_password.length < 8) {
      setPasswordMessage("New password must be at least 8 characters.");
      return;
    }
    if (password.new_password !== password.confirm_password) {
      setPasswordMessage("New passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    try {
      await sessionRequest("/api/account/password", {
        method: "POST",
        body: JSON.stringify({
          current_password: password.current_password,
          new_password: password.new_password
        })
      });
      setPassword({ current_password: "", new_password: "", confirm_password: "" });
      setPasswordMessage("Password updated.");
    } catch (cause) {
      setPasswordMessage(cause instanceof Error ? cause.message : "Unable to update password");
    } finally {
      setPasswordBusy(false);
    }
  }

  if (loading) return <div className={className}>{t("loading")}</div>;

  return (
    <div className={className}>
      <section className={sectionClass}>
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your personal account details.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium">Full name</span>
            <input
              className={fieldClass}
              onChange={(event) => setProfile({ ...profile, display_name: event.target.value })}
              value={profile.display_name}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium">Email</span>
            <input
              className={fieldClass}
              onChange={(event) => setProfile({ ...profile, email: event.target.value })}
              type="email"
              value={profile.email}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium">Phone</span>
            <input
              className={fieldClass}
              onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
              type="tel"
              value={profile.phone}
            />
          </label>
        </div>
        {profileMessage ? <div className="mt-3 text-sm" role="status">{profileMessage}</div> : null}
        <button className={`mt-4 ${buttonClass}`} disabled={profileBusy} onClick={() => void saveProfile()} type="button">
          {profileBusy ? t("saving") : t("save")}
        </button>
      </section>

      <section className={`mt-6 ${sectionClass}`}>
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Change password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Requires your current password. At least 8 characters.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium">Current password</span>
            <input
              className={fieldClass}
              onChange={(event) => setPassword({ ...password, current_password: event.target.value })}
              type="password"
              value={password.current_password}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium">New password</span>
            <input
              className={fieldClass}
              onChange={(event) => setPassword({ ...password, new_password: event.target.value })}
              type="password"
              value={password.new_password}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-medium">Confirm new password</span>
            <input
              className={fieldClass}
              onChange={(event) => setPassword({ ...password, confirm_password: event.target.value })}
              type="password"
              value={password.confirm_password}
            />
          </label>
        </div>
        {passwordMessage ? <div className="mt-3 text-sm" role="status">{passwordMessage}</div> : null}
        <button
          className={`mt-4 ${buttonClass}`}
          disabled={passwordBusy || !password.current_password || !password.new_password}
          onClick={() => void changePassword()}
          type="button"
        >
          {passwordBusy ? t("saving") : "Update password"}
        </button>
      </section>

      <LanguageSettings className={`mt-6 ${sectionClass}`} />
    </div>
  );
}
