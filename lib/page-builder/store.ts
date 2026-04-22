import { InMemoryDataStore } from "./data-store";
import { InMemoryPageMetaStore, createPageManager } from "./page-manager";
import { createTemplateRegistry } from "./templates";
import { createMediaLibrary } from "./media-library";

export const dataStore = new InMemoryDataStore();
export const metaStore = new InMemoryPageMetaStore();
export const pageManager = createPageManager({ dataStore, metaStore });
export const templateRegistry = createTemplateRegistry();
export const mediaLibrary = createMediaLibrary();
