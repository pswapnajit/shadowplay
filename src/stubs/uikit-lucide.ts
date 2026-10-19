/**
 * Shadowplay draws no spatial UI, but the SDK's UI kit statically imports the
 * whole Lucide icon set (~1,600 icons, ~4.6 MB of source). This stub keeps the
 * two icons the kit's components reference and drops the rest, cutting the
 * bundle roughly in half for a faster cold start.
 */
export { ChevronDown, ChevronDownIcon } from '../../node_modules/@pmndrs/uikit-lucide/dist/ChevronDown.js';
export { Check, CheckIcon } from '../../node_modules/@pmndrs/uikit-lucide/dist/Check.js';
