// Public types. Zero runtime; pure type definitions.

export type EventType =
  | "feature.used"
  | "feature.engagement"
  | "session.active"
  | "feature.first_use"
  | "customer.identified";

export type State = "UNINITIALIZED" | "READY" | "DISABLED";

export interface VektisConfig {
  apiKey: string;
  endpoint?: string;
  flushIntervalMs?: number;
  flushThreshold?: number;
  /**
   * Whether to allow non-publishable (`vk_*` without the `pub_` segment) keys in the
   * browser SDK. Default `true` in the 1.2.x line — a non-publishable key triggers a
   * `VEK_TRK_NON_PUBLISHABLE_KEY` warning and the SDK proceeds. Set to `false` to make
   * the SDK refuse to initialize unless the key starts with `vk_pub_`. The default
   * is expected to flip to `false` in a future major.
   */
  allowFullScopeKey?: boolean;
  debug?: boolean;
}

export interface VektisIdentity {
  customer_id: string;
  user_id?: string;
}

export type PropertyValue = string | number | boolean;

export interface TrackData {
  feature_id?: string;
  action?: string;
  properties?: Record<string, PropertyValue>;
}

export interface VektisStatus {
  state: State;
  queueLength: number;
  identityCustomerId: string | null;
  identityUserId: string | null;
}

// Wire format — what the SDK actually sends to the server. Mirrors
// @vektis-io/events-schema's TrackingEvent inferred type.
export interface TrackingEvent {
  event_id: string;
  event_type: EventType;
  customer_id: string;
  feature_id?: string;
  user_id?: string;
  action?: string;
  properties?: Record<string, PropertyValue>;
  timestamp?: string;
}

export interface TrackEventsPayload {
  events: TrackingEvent[];
  // Publishable API key. Used on the sendBeacon path so the key doesn't end up
  // in browser history / server access logs as a URL query param. Mirrors the
  // optional field added to @vektis-io/events-schema in 1.1.0.
  key?: string;
}
