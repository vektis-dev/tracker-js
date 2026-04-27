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
  autoSessionActive?: boolean;
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
}
