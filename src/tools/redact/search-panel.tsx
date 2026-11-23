"use client";

import { Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PresetId } from "./core/model";
import { PRESET_MATCHERS } from "./core/presets";
import type { SearchQuery } from "./messages";

export interface SearchPanelProps {
  disabled?: boolean;
  searching?: boolean;
  onSearch(query: SearchQuery): Promise<void>;
}

type SearchTab = "text" | "regex" | "presets";

/**
 * Search & Redact panel supporting plain text, custom regex, and one-click
 * sensitive-data presets (email, phone, PAN, Aadhaar, IFSC, card numbers, dates).
 *
 * @param props Disabled/loading flags and async search callback.
 * @returns Search panel section.
 */
export function SearchPanel({
  disabled,
  searching,
  onSearch,
}: SearchPanelProps) {
  const [tab, setTab] = useState<SearchTab>("presets");
  const [textQuery, setTextQuery] = useState("");
  const [regexPattern, setRegexPattern] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [selectedPresets, setSelectedPresets] = useState<PresetId[]>([
    "email",
    "phone",
    "pan",
    "aadhaar",
    "ifsc",
    "card",
    "date",
  ]);
  const [error, setError] = useState<string | null>(null);

  const busy = Boolean(disabled || searching);

  const togglePreset = (id: PresetId) => {
    setSelectedPresets((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (tab === "text") {
        if (!textQuery.trim()) {
          setError("Enter text to search for.");
          return;
        }
        await onSearch({ mode: "text", query: textQuery, caseSensitive });
      } else if (tab === "regex") {
        if (!regexPattern) {
          setError("Enter a regular expression pattern.");
          return;
        }
        new RegExp(regexPattern);
        await onSearch({
          mode: "regex",
          pattern: regexPattern,
          caseSensitive,
        });
      } else {
        if (selectedPresets.length === 0) {
          setError("Select at least one preset.");
          return;
        }
        await onSearch({ mode: "presets", presets: selectedPresets });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not run the search.",
      );
    }
  };

  return (
    <section
      aria-label="Search and redact"
      className="space-y-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Search &amp; redact</h2>
        <div
          role="tablist"
          aria-label="Search mode"
          className="bg-muted inline-flex rounded-md p-0.5"
        >
          {(
            [
              ["presets", "Presets"],
              ["text", "Plain text"],
              ["regex", "Regex"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              disabled={busy}
              onClick={() => {
                setTab(value);
                setError(null);
              }}
              className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
                tab === value
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={(e) => void runSearch(e)} className="space-y-3">
        {tab === "presets" && (
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PRESET_MATCHERS.map((preset) => {
                const checked = selectedPresets.includes(preset.source);
                return (
                  <label
                    key={preset.source}
                    className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => togglePreset(preset.source)}
                      className="accent-primary mt-0.5 size-4 shrink-0 rounded border"
                    />
                    <span className="leading-tight">
                      <span className="block font-medium">{preset.label}</span>
                      <span className="text-muted-foreground">
                        {preset.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {tab === "text" && (
          <div className="space-y-2">
            <label htmlFor="redact-text-query" className="block text-xs font-medium">
              Text to find across all pages
            </label>
            <Input
              id="redact-text-query"
              value={textQuery}
              disabled={busy}
              placeholder="e.g. Confidential or Jane Doe"
              onChange={(e) => setTextQuery(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={caseSensitive}
                disabled={busy}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className="accent-primary size-4 rounded border"
              />
              <span>Match case</span>
            </label>
          </div>
        )}

        {tab === "regex" && (
          <div className="space-y-2">
            <label htmlFor="redact-regex-pattern" className="block text-xs font-medium">
              Regular expression
            </label>
            <Input
              id="redact-regex-pattern"
              value={regexPattern}
              disabled={busy}
              placeholder="e.g. ACC-\d{4,8}"
              className="font-mono text-xs"
              onChange={(e) => setRegexPattern(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={caseSensitive}
                disabled={busy}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                className="accent-primary size-4 rounded border"
              />
              <span>Match case</span>
            </label>
          </div>
        )}

        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}

        <Button
          type="submit"
          variant="secondary"
          className="min-h-10 w-full"
          disabled={busy}
        >
          {tab === "presets" ? (
            <Sparkles aria-hidden="true" className="size-4" />
          ) : (
            <Search aria-hidden="true" className="size-4" />
          )}
          {searching ? "Searching…" : "Find matches"}
        </Button>
      </form>
    </section>
  );
}
