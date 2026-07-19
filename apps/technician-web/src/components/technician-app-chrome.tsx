"use client";

import {
  BriefcaseBusiness,
  CircleUserRound,
  History,
  MessageSquare,
  MoreHorizontal,
  PhoneCall,
  ShieldAlert,
  WalletCards
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type TechnicianNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type ActiveJobActionItem = {
  key: "messages" | "call" | "safety" | "more";
  label: string;
  icon: LucideIcon;
  danger?: boolean;
};

export const technicianNavItems: TechnicianNavItem[] = [
  { href: "/jobs", label: "Work", icon: BriefcaseBusiness },
  { href: "/activity", label: "Activity", icon: History },
  { href: "/earnings", label: "Earnings", icon: WalletCards },
  { href: "/profile", label: "Account", icon: CircleUserRound }
];

export const activeJobActionItems: ActiveJobActionItem[] = [
  { key: "messages", label: "Message", icon: MessageSquare },
  { key: "call", label: "Call", icon: PhoneCall },
  { key: "safety", label: "Safety", icon: ShieldAlert, danger: true },
  { key: "more", label: "More", icon: MoreHorizontal }
];
