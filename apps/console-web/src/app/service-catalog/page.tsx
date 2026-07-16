"use client";

import type { ServiceCategory, ServiceCatalogStatus, ServiceSkill } from "@cluexp/api-client";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, PageHeader, Badge } from "@cluexp/console-ui";
import { Plus, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppFrame } from "../frame";

const STATUSES: ServiceCatalogStatus[] = ["draft", "active", "deprecated"];
type SkillForm = ServiceSkill & { category_code: string };

function emptyCategoryForm() {
  return { code: "", label: "", status: "draft" as ServiceCatalogStatus, sort_order: 100 };
}

function emptySkillForm(categoryCode = "locksmith") {
  return {
    code: `${categoryCode}.`,
    label: "",
    category_code: categoryCode,
    status: "draft" as ServiceCatalogStatus,
    requires_verification: false,
    sort_order: 100
  };
}

export default function ServiceCatalogPage() {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("locksmith");
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm());
  const [skillForm, setSkillForm] = useState(emptySkillForm());
  const [editingSkillCode, setEditingSkillCode] = useState<string | null>(null);
  const [skillEditForm, setSkillEditForm] = useState<SkillForm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/service-catalog", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.detail || "Unable to load service catalog");
      return;
    }
    const next = body.categories ?? [];
    setCategories(next);
    if (next.length > 0 && !next.some((category: ServiceCategory) => category.code === selectedCategory)) {
      setSelectedCategory(next[0].code);
    }
  }, [selectedCategory]);

  useEffect(() => { void refresh(); }, [refresh]);

  const currentCategory = useMemo(
    () => categories.find((category) => category.code === selectedCategory) ?? categories[0],
    [categories, selectedCategory]
  );

  useEffect(() => {
    if (currentCategory) setSkillForm(emptySkillForm(currentCategory.code));
    setEditingSkillCode(null);
    setSkillEditForm(null);
  }, [currentCategory?.code]);

  async function saveCategory(category: Pick<ServiceCategory, "code" | "label" | "status" | "sort_order">) {
    setBusy(`category:${category.code}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/service-catalog/categories/${encodeURIComponent(category.code)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(category)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save category");
      setMessage("Service category saved.");
      setCategoryForm(emptyCategoryForm());
      await refresh();
      setSelectedCategory(category.code);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save category");
    } finally {
      setBusy(null);
    }
  }

  async function saveSkill(skill: SkillForm, options: { resetAddForm?: boolean; closeEditor?: boolean } = {}) {
    setBusy(`skill:${skill.code}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/service-catalog/skills/${encodeURIComponent(skill.code)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(skill)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Unable to save skill");
      setMessage("Service skill saved.");
      if (options.resetAddForm) setSkillForm(emptySkillForm(skill.category_code));
      if (options.closeEditor) {
        setEditingSkillCode(null);
        setSkillEditForm(null);
      }
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save skill");
    } finally {
      setBusy(null);
    }
  }

  function beginEditSkill(skill: ServiceSkill, categoryCode: string) {
    setEditingSkillCode(skill.code);
    setSkillEditForm({ ...skill, category_code: categoryCode });
  }

  return (
    <AppFrame>
      <PageHeader
        kicker="Platform"
        title="Service Catalog"
        description="Categories and dispatchable leaf skills used by provider capabilities, technician profiles, and future verticals."
      />
      <div className="space-y-6">
        {message ? <div className="rounded-md border border-border bg-secondary p-3 text-sm" role="status">{message}</div> : null}
        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Categories</CardTitle>
              <CardDescription>Activate a category when the business is ready to offer that vertical.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {categories.map((category) => (
                  <button
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${currentCategory?.code === category.code ? "border-primary bg-primary/10" : "border-border"}`}
                    key={category.code}
                    onClick={() => setSelectedCategory(category.code)}
                    type="button"
                  >
                    <span>
                      <span className="block font-medium">{category.label}</span>
                      <span className="text-xs text-muted-foreground">{category.code}</span>
                    </span>
                    <Badge variant={category.status === "active" ? "success" : category.status === "draft" ? "outline" : "neutral"}>{category.status}</Badge>
                  </button>
                ))}
              </div>
              {currentCategory ? (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <div className="text-sm font-semibold">Edit {currentCategory.label}</div>
                  <div className="flex flex-wrap gap-2">
                    {STATUSES.map((status) => (
                      <Button
                        disabled={busy !== null || currentCategory.status === status}
                        key={status}
                        onClick={() => void saveCategory({ ...currentCategory, status })}
                        size="sm"
                        variant="outline"
                      >
                        Set {status}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="text-sm font-semibold">Add category</div>
                <Input placeholder="hvac" value={categoryForm.code} onChange={(event) => setCategoryForm((prev) => ({ ...prev, code: event.target.value }))} />
                <Input placeholder="HVAC" value={categoryForm.label} onChange={(event) => setCategoryForm((prev) => ({ ...prev, label: event.target.value }))} />
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={categoryForm.status} onChange={(event) => setCategoryForm((prev) => ({ ...prev, status: event.target.value as ServiceCatalogStatus }))}>
                  {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <Button disabled={!categoryForm.code || !categoryForm.label || busy !== null} onClick={() => void saveCategory(categoryForm)}>
                  <Plus className="size-4" />Add category
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{currentCategory?.label ?? "Skills"}</CardTitle>
              <CardDescription>Leaf skills are the exact capability codes technicians carry and dispatch checks.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentCategory ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {currentCategory.skills.map((skill) => (
                    <div className="rounded-md border border-border p-3" key={skill.code}>
                      {editingSkillCode === skill.code && skillEditForm ? (
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">Edit skill</div>
                              <div className="text-xs text-muted-foreground">{skill.code}</div>
                            </div>
                            <Badge variant={skillEditForm.status === "active" ? "success" : skillEditForm.status === "draft" ? "outline" : "neutral"}>{skillEditForm.status}</Badge>
                          </div>
                          <Input value={skillEditForm.label} onChange={(event) => setSkillEditForm((prev) => prev ? ({ ...prev, label: event.target.value }) : prev)} />
                          <div className="grid gap-3 sm:grid-cols-3">
                            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={skillEditForm.status} onChange={(event) => setSkillEditForm((prev) => prev ? ({ ...prev, status: event.target.value as ServiceCatalogStatus }) : prev)}>
                              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                            </select>
                            <label className="flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm">
                              <input checked={skillEditForm.requires_verification} onChange={(event) => setSkillEditForm((prev) => prev ? ({ ...prev, requires_verification: event.target.checked }) : prev)} type="checkbox" />
                              Verification
                            </label>
                            <Input min={1} type="number" value={skillEditForm.sort_order} onChange={(event) => setSkillEditForm((prev) => prev ? ({ ...prev, sort_order: Number(event.target.value) }) : prev)} />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button disabled={!skillEditForm.label || busy !== null} onClick={() => void saveSkill(skillEditForm, { closeEditor: true })} size="sm">
                              <Save className="size-4" />Save changes
                            </Button>
                            <Button disabled={busy !== null} onClick={() => { setEditingSkillCode(null); setSkillEditForm(null); }} size="sm" variant="outline">
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">{skill.label}</div>
                              <div className="text-xs text-muted-foreground">{skill.code}</div>
                            </div>
                            <Badge variant={skill.status === "active" ? "success" : skill.status === "draft" ? "outline" : "neutral"}>{skill.status}</Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge variant={skill.requires_verification ? "warn" : "outline"}>{skill.requires_verification ? "Verification required" : "No extra verification"}</Badge>
                            <Badge variant="outline">Order {skill.sort_order}</Badge>
                            <Button disabled={busy !== null} onClick={() => beginEditSkill(skill, currentCategory.code)} size="sm" variant="outline">
                              Edit
                            </Button>
                            {STATUSES.map((status) => (
                          <Button
                            disabled={busy !== null || skill.status === status}
                            key={status}
                            onClick={() => void saveSkill({ ...skill, category_code: currentCategory.code, status })}
                            size="sm"
                            variant="outline"
                          >
                            Set {status}
                          </Button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
              {currentCategory ? (
                <div className="space-y-3 rounded-md border border-border p-3">
                  <div className="text-sm font-semibold">Add skill to {currentCategory.label}</div>
                  <Input value={skillForm.code} onChange={(event) => setSkillForm((prev) => ({ ...prev, code: event.target.value }))} />
                  <Input placeholder="Vehicle key programming" value={skillForm.label} onChange={(event) => setSkillForm((prev) => ({ ...prev, label: event.target.value }))} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={skillForm.status} onChange={(event) => setSkillForm((prev) => ({ ...prev, status: event.target.value as ServiceCatalogStatus }))}>
                      {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    <label className="flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm">
                      <input checked={skillForm.requires_verification} onChange={(event) => setSkillForm((prev) => ({ ...prev, requires_verification: event.target.checked }))} type="checkbox" />
                      Verification
                    </label>
                    <Input min={1} type="number" value={skillForm.sort_order} onChange={(event) => setSkillForm((prev) => ({ ...prev, sort_order: Number(event.target.value) }))} />
                  </div>
                  <Button disabled={!skillForm.code || !skillForm.label || busy !== null} onClick={() => void saveSkill(skillForm, { resetAddForm: true })}>
                    <Save className="size-4" />Save skill
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppFrame>
  );
}
