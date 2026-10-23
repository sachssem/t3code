import {
  ClientSettingsSchema,
  migrateLegacyClientSettings,
  type ClientSettings,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import {
  getLocalStorageItem,
  LocalStorageOperationError,
  setLocalStorageItem,
} from "./hooks/useLocalStorage";

const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";
const StoredClientSettings = Schema.Record(Schema.String, Schema.Unknown);
const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function readBrowserClientSettings(): ClientSettings | null {
  if (!hasWindow()) {
    return null;
  }

  // Read as a plain document first so keys that were replaced reach their successors.
  const stored = getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, StoredClientSettings);
  if (stored === null) return null;
  try {
    return decodeClientSettings(migrateLegacyClientSettings(stored));
  } catch (cause) {
    throw new LocalStorageOperationError({
      operation: "decode",
      storageKey: CLIENT_SETTINGS_STORAGE_KEY,
      cause,
    });
  }
}

export function writeBrowserClientSettings(settings: ClientSettings): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, settings, ClientSettingsSchema);
}
