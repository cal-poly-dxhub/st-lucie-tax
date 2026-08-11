import { useCallback, useEffect, useState } from "react";
import { Button, Field, Input } from "@st-lucie/ui";
import { fetchConfig, updateConfig, type GlobalConfig } from "@/config-api";
import { useResource } from "./use-resource";
import { ErrorBanner, Section, Spinner } from "./parts";

// Bounds on the two numeric scheduling knobs. These feed the slot finder
// directly, so out-of-range values are a havoc vector: a huge padding starves
// the day of slots, and a huge lookahead makes the booking search enumerate
// months of availability. Keep both to sane operational ranges.
const PADDING_MIN = 0;
const PADDING_MAX = 120; // minutes of buffer between appointments
const LOOKAHEAD_MIN = 1;
const LOOKAHEAD_MAX = 365; // days a citizen can book ahead

function rangeError(label: string, raw: string, min: number, max: number): string | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    return `${label} must be a whole number between ${min} and ${max}.`;
  }
  return null;
}

export function GlobalConfigPage() {
  const { data, error, loading, saving, mutate } = useResource<GlobalConfig>(fetchConfig);

  const [timezone, setTimezone] = useState("");
  const [padding, setPadding] = useState("");
  const [lookahead, setLookahead] = useState("");

  // Sync the form from the server whenever a load lands.
  useEffect(() => {
    if (!data) return;
    setTimezone(data.timezone ?? "");
    setPadding(String(data.scheduling_block_padding ?? ""));
    setLookahead(String(data.default_lookahead_days ?? ""));
  }, [data]);

  const paddingErr = rangeError("Block padding", padding, PADDING_MIN, PADDING_MAX);
  const lookaheadErr = rangeError("Lookahead days", lookahead, LOOKAHEAD_MIN, LOOKAHEAD_MAX);
  const formError = paddingErr ?? lookaheadErr;

  const save = useCallback(() => {
    // Guard again at save time — the browser min/max on <input type=number> is
    // advisory (a typed value can exceed it), so never trust it alone.
    if (rangeError("Block padding", padding, PADDING_MIN, PADDING_MAX)) return;
    if (rangeError("Lookahead days", lookahead, LOOKAHEAD_MIN, LOOKAHEAD_MAX)) return;
    mutate(
      () =>
        updateConfig({
          timezone: timezone.trim() || undefined,
          schedulingBlockPadding: Number(padding),
          defaultLookaheadDays: Number(lookahead),
        }),
      "Global settings saved.",
    );
  }, [mutate, timezone, padding, lookahead]);

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (loading && !data) return <Spinner />;

  return (
    <Section
      title="Global settings"
      description="System-wide scheduling defaults. These apply to every office unless an office overrides them."
    >
      <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
        <Field label="Timezone" htmlFor="tz" hint="IANA name, e.g. America/New_York">
          <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </Field>
        <Field
          label="Block padding"
          htmlFor="padding"
          hint={`Minutes added to each appointment block (${PADDING_MIN}–${PADDING_MAX})`}
        >
          <Input
            id="padding"
            type="number"
            min={PADDING_MIN}
            max={PADDING_MAX}
            value={padding}
            onChange={(e) => setPadding(e.target.value)}
          />
        </Field>
        <Field
          label="Lookahead days"
          htmlFor="lookahead"
          hint={`How far ahead citizens can book (${LOOKAHEAD_MIN}–${LOOKAHEAD_MAX})`}
        >
          <Input
            id="lookahead"
            type="number"
            min={LOOKAHEAD_MIN}
            max={LOOKAHEAD_MAX}
            value={lookahead}
            onChange={(e) => setLookahead(e.target.value)}
          />
        </Field>
      </div>

      {formError && (
        <p className="mt-3 text-sm font-medium text-stop-600" role="alert">
          {formError}
        </p>
      )}

      <div className="mt-5">
        <Button variant="go" loading={saving} disabled={formError !== null} onClick={save}>
          Save settings
        </Button>
      </div>
    </Section>
  );
}
