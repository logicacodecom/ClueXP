"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { Badge } from "./badge";
import { Button } from "./button";

export const SKILL_CATALOG = {
  vehicle: { code: "vehicle", label: "Vehicle lockout", icon: "🚗" },
  home: { code: "home", label: "Residential lockout", icon: "🏠" },
  business: { code: "business", label: "Business/commercial lockout", icon: "🏢" },
  broken_key: { code: "broken_key", label: "Broken key extraction", icon: "🔑" },
  rekey: { code: "rekey", label: "Rekey", icon: "🔄" },
  smart_lock: { code: "smart_lock", label: "Smart lock", icon: "📱" },
  key_programming: { code: "key_programming", label: "Key programming", icon: "⚙️" },
} as const;

export type SkillCode = keyof typeof SKILL_CATALOG;

export function skillLabel(skillCode: string): string {
  const knownSkill = SKILL_CATALOG[skillCode as SkillCode];
  if (knownSkill) return knownSkill.label;
  return skillCode
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface SkillSelectProps {
  selected: string[];
  onChange: (skills: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function SkillSelect({ selected, onChange, placeholder = "Select skills...", className }: SkillSelectProps) {
  const availableSkills = Object.entries(SKILL_CATALOG) as [SkillCode, typeof SKILL_CATALOG[keyof typeof SKILL_CATALOG]][];

  const toggleSkill = (skillCode: SkillCode) => {
    if (selected.includes(skillCode)) {
      onChange(selected.filter((s) => s !== skillCode));
    } else {
      onChange([...selected, skillCode]);
    }
  };

  const removeSkill = (skillCode: string, event: React.MouseEvent) => {
    event.stopPropagation();
    onChange(selected.filter((s) => s !== skillCode));
  };

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {selected.map((skillCode) => {
        const skill = SKILL_CATALOG[skillCode as SkillCode];
        const label = skillLabel(skillCode);
        return (
          <Badge
            key={skillCode}
            variant="outline"
            className="gap-1.5 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
          >
            {skill?.icon ? <span>{skill.icon}</span> : null}
            <span>{label}</span>
            <button
              type="button"
              onClick={(e) => removeSkill(skillCode, e)}
              className="ml-1 rounded-full p-0.5 hover:bg-primary/20"
            >
              <X className="size-3" />
            </button>
          </Badge>
        );
      })}
      {availableSkills.map(([code, skill]) => {
        if (selected.includes(code)) return null;
        return (
          <Button
            key={code}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => toggleSkill(code)}
            className="gap-2 text-xs"
          >
            <span>{skill.icon}</span>
            {skill.label}
          </Button>
        );
      })}
      {selected.length === 0 && availableSkills.length > 0 && (
        <span className="text-xs text-muted-foreground">{placeholder}</span>
      )}
    </div>
  );
}
