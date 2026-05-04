# `vektis-instrument` — canonical insertion rules

This file is the source of truth for which `vektis.track()` call to insert at each `insertion_point` from `.vektis/discover-output.json`. The skill consults this table for every approved candidate.

When `agent-prompt-builder.ts` (VEK-289) ships, this file should be cross-referenced with it; until then, this file IS the canonical contract.

## Six rules (v1)

For each rule, the skill inserts the call at the file/line specified by the matching `insertion_point` in the discover-output candidate.

### 1. `valueType: count` — role `action`

Insert:

```ts
vektis.track('feature.used', { feature_id: '<feature_id>' });
```

One insertion point per candidate. The action that increments the count.

### 2. `valueType: percentage` — role `numerator_action`

Insert:

```ts
vektis.track('feature.used', { feature_id: '<feature_id>' });
```

One of two insertion points for percentage candidates. The numerator: "the success path."

### 3. `valueType: percentage` — role `denominator_action`

Insert:

```ts
vektis.track('feature.engagement', {
  feature_id: '<feature_id>',
  action: '<denominator_action_name>',
});
```

One of two insertion points for percentage candidates. The denominator: "the attempt."

### 4. `valueType: duration` — role `start_action`

Insert:

```ts
vektis.track('feature.engagement', {
  feature_id: '<feature_id>',
  action: '<start_action_name>',
});
```

One of two insertion points for duration candidates. Marks when the timed flow begins.

### 5. `valueType: duration` — role `end_action`

Insert:

```ts
vektis.track('feature.engagement', {
  feature_id: '<feature_id>',
  action: '<end_action_name>',
});
```

One of two insertion points for duration candidates. Marks when the timed flow ends. Vanalytics computes duration as `end_event_time - start_event_time` per session.

### 6. `valueType: activity` — role `action`

Insert:

```ts
vektis.track('feature.engagement', {
  feature_id: '<feature_id>',
  action: '<event_name>',
});
```

One insertion point per candidate. Activity is a composite engagement metric — the `action` mirrors the original event name from the customer's existing analytics SDK call.

### `valueType: currency` — never auto-instrumented

Currency metrics require manual data entry in v1. Skip these candidates entirely with a warning row in the summary: `"<feature_id> (currency) — manual entry only; configure in app.vektis.io"`.

## Templating rules

- `<feature_id>` is the candidate's `featureId` (already lowercase-hyphen normalized by `vektis-discover`).
- `<denominator_action_name>` is `metricConfig.denominator_action` from the discover-output, NOT the SDK event name.
- `<start_action_name>` / `<end_action_name>` are `metricConfig.start_action` / `metricConfig.end_action`.
- `<event_name>` is `existing_sdk_call.event_name` (the original analytics call's event string).

## Migration policy (NEVER remove existing SDK calls)

The skill ADDS `vektis.track()` calls alongside existing analytics SDK calls (mixpanel/segment/amplitude/posthog/ga4). It NEVER removes the original calls. Customers handle removal as a separate migration concern once they've validated VEKTIS coverage in production.

## Drift guard (per insertion point)

Before writing, verify the target line at `insertion_point.file:insertion_point.line` still contains the expected SDK call signature (e.g., `mixpanel.track(`). If the line has drifted (file edited since `vektis-discover` ran), skip that file with a warning row in the summary. Do NOT fail the whole batch.
