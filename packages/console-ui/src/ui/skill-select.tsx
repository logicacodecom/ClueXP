"use client";

import * as React from "react";
import { X } from "lucide-react";
import { DEFAULT_SERVICE_CATALOG, serviceSkillLabel } from "@cluexp/api-client";
import { cn } from "../lib/cn";
import { Badge } from "./badge";
import { Button } from "./button";

export const SKILL_CATALOG = Object.fromEntries(
  DEFAULT_SERVICE_CATALOG.flatMap((category) =>
    category.skills
      .filter((skill) => skill.status === "active")
      .map((skill) => [skill.code, { ...skill, category: category.code }])
  )
);

export type SkillCode = keyof typeof SKILL_CATALOG;

export function skillLabel(skillCode: string): string {
  return serviceSkillLabel(skillCode);
}

export interface SkillSelectProps {
  selected: string[];
  onChange: (skills: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function SkillSelect({ selected, onChange, placeholder = "Select skills...", className }: SkillSelectProps) {
  const availableSkills = DEFAULT_SERVICE_CATALOG
    .filter((category) => category.status === "active")
    .map((category) => ({
      ...category,
      skills: category.skills.filter((skill) => skill.status === "active")
    }))
    .filter((category) => category.skills.length > 0);

  const toggleSkill = (skillCode: string) => {
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
    <div className={cn("space-y-3", className)}>
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((skillCode) => {
            const label = skillLabel(skillCode);
            return (
              <Badge
                key={skillCode}
                variant="outline"
                className="gap-1.5 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
              >
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
        </div>
      ) : null}
      <div className="space-y-3">
        {availableSkills.map((category) => (
          <div key={category.code} className="space-y-2">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{category.label}</div>
            <div className="flex flex-wrap gap-2">
              {category.skills.map((skill) => {
                if (selected.includes(skill.code)) return null;
                return (
                  <Button
                    key={skill.code}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => toggleSkill(skill.code)}
                    className="text-xs"
                  >
                    {skill.label}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {selected.length === 0 && availableSkills.length > 0 ? (
        <span className="text-xs text-muted-foreground">{placeholder}</span>
      ) : null}
    </div>
  );
}
