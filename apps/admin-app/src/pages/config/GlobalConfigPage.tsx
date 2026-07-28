import { useCallback, useEffect, useState } from "react";
import { Button, Field, Input } from "@st-lucie/ui";
import { fetchConfig, updateConfig, type GlobalConfig } from "@/config-api";
import { useResource } from "./use-resource";
import { ErrorBanner, Section, Spinner } from "./parts";

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

  const save = useCallback(() => {
    const paddingNum = Number(padding);
    const lookaheadNum = Number(lookahead);
    mutate(
      () =>
        updateConfig({
          timezone: timezone.trim() || undefined,
          schedulingBlockPadding: Number.isFinite(paddingNum) ? paddingNum : undefined,
          defaultLookaheadDays: Number.isFinite(lookaheadNum) ? lookaheadNum : undefined,
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
          hint="Minutes added to each appointment block"
        >
          <Input
            id="padding"
            type="number"
            min={0}
            value={padding}
            onChange={(e) => setPadding(e.target.value)}
          />
        </Field>
        <Field label="Lookahead days" htmlFor="lookahead" hint="How far ahead citizens can book">
          <Input
            id="lookahead"
            type="number"
            min={1}
            value={lookahead}
            onChange={(e) => setLookahead(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-5">
        <Button variant="go" loading={saving} onClick={save}>
          Save settings
        </Button>
      </div>
    </Section>
  );
}
