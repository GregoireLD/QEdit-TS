/**
 * Save-format compatibility logic for the Save As dialog.
 *
 * Pure functions — no side effects, no I/O.
 */

import { BinVersion, QstFormat } from './model/types';
import type { Quest, PackagingType, TargetPlatform, SaveFormat } from './model/types';
import type { CompatResult } from './compatibility';

// ─── Platform availability per packaging type ──────────────────────────────

const PACKAGING_PLATFORMS: Record<PackagingType, TargetPlatform[]> = {
  server:       ['PC', 'DC', 'GC', 'BB'],
  // Xbox uses identical packet format to PC for download; shown as "PC / Xbox" in UI.
  download:     ['PC', 'DC', 'GC'],
  compressed:   ['PC', 'DC', 'GC', 'BB'],
  uncompressed: ['PC', 'DC', 'GC', 'BB'],
  rawbin:       ['PC', 'DC', 'GC', 'BB'],
  // Project exports all files as-is — the platform row shows an informational note.
  project:      [],
};

export function platformsForPackaging(packaging: PackagingType): TargetPlatform[] {
  return PACKAGING_PLATFORMS[packaging];
}

// ─── Platform options (enabled / grayed with tooltip) ─────────────────────

export interface PlatformOption {
  platform: TargetPlatform;
  /** If set, the option is grayed out with this tooltip text. */
  disabledReason?: string;
}

function hasNonAsciiMeta(bin: Quest['bin']): boolean {
  return /[^\x00-\x7F]/.test(bin.title + bin.info + bin.description);
}

export function getPlatformOptions(
  packaging: PackagingType,
  quest: Quest,
  compatResults: CompatResult[] | null,
): PlatformOption[] {
  return platformsForPackaging(packaging).map(platform => {
    // DC — check non-ASCII metadata AND DC V1 compat errors
    if (platform === 'DC') {
      if (hasNonAsciiMeta(quest.bin)) {
        return {
          platform,
          disabledReason:
            'Quest metadata contains Unicode characters that cannot be stored in DC ASCII format',
        };
      }
      if (compatResults) {
        const errs = compatResults[0]?.issues.filter(i => i.severity === 'error') ?? [];
        if (errs.length > 0) {
          return {
            platform,
            disabledReason: `${errs.length} compat error${errs.length > 1 ? 's' : ''} for DC V1 — see Compat Check`,
          };
        }
      }
    }

    // PC / Xbox — check DC V2 & PC compat errors (index 1)
    if (platform === 'PC' || platform === 'Xbox') {
      if (compatResults) {
        const errs = compatResults[1]?.issues.filter(i => i.severity === 'error') ?? [];
        if (errs.length > 0) {
          return {
            platform,
            disabledReason: `${errs.length} compat error${errs.length > 1 ? 's' : ''} for PC — see Compat Check`,
          };
        }
      }
    }

    // GC — check GC compat errors (index 2)
    if (platform === 'GC') {
      if (compatResults) {
        const errs = compatResults[2]?.issues.filter(i => i.severity === 'error') ?? [];
        if (errs.length > 0) {
          return {
            platform,
            disabledReason: `${errs.length} compat error${errs.length > 1 ? 's' : ''} for GC — see Compat Check`,
          };
        }
      }
    }

    // BB — always a valid target (superset; blank BBData generated if needed)

    return { platform };
  });
}

// ─── Save warnings ─────────────────────────────────────────────────────────

export interface SaveWarning {
  message: string;
  /** 'destructive' = data loss that cannot be recovered from the saved file. */
  severity: 'info' | 'destructive';
}

export function getSaveWarnings(format: SaveFormat, quest: Quest): SaveWarning[] {
  const { packaging, platform } = format;
  const warnings: SaveWarning[] = [];

  // Project exports all embedded files as-is — no conversion, no warnings.
  if (packaging === 'project') return warnings;

  if (quest.bin.version === BinVersion.BB && platform !== 'BB') {
    warnings.push({
      message:
        'The BB metadata block (BBData) will be discarded. This cannot be recovered from the saved file.',
      severity: 'destructive',
    });
  }

  if (quest.bin.version !== BinVersion.BB && platform === 'BB') {
    warnings.push({
      message:
        'A blank BB metadata block will be generated. BB-specific quest settings will need to be filled in separately.',
      severity: 'info',
    });
  }

  if (packaging === 'rawbin') {
    warnings.push({
      message: 'Only the .bin file will be saved. The .dat and all embedded assets will not be included.',
      severity: 'destructive',
    });
  }

  return warnings;
}

// ─── Default format ────────────────────────────────────────────────────────

/** Derive the logical save format from the quest's current in-memory state. */
export function defaultSaveFormat(quest: Quest): SaveFormat {
  const packaging: PackagingType =
    quest.format === QstFormat.Download ? 'download' : 'server';

  let platform: TargetPlatform;
  if (quest.bin.version === BinVersion.BB) {
    platform = 'BB';
  } else if (quest.bin.version === BinVersion.DC) {
    platform = 'DC';
  } else {
    // PC bin — could be in BB or GC container
    platform = quest.format === QstFormat.BB ? 'BB' : 'PC';
  }

  return { packaging, platform };
}

/** Short human-readable description of the quest's current format for the dialog header. */
export function describeCurrentFormat(quest: Quest): string {
  const pkg =
    quest.format === QstFormat.Download ? 'Download' :
    quest.format === QstFormat.BB       ? 'BB Server' :
                                          'Server';
  return `${quest.bin.version} · ${pkg}`;
}

/** Short label for a SaveFormat, used in the sidebar after a Save / Save As. */
export function describeSavedFormat(format: SaveFormat): string {
  if (format.packaging === 'project') return 'Project ZIP';
  if (format.packaging === 'rawbin')  return `${format.platform} · .bin only`;
  const pkgLabel: Record<string, string> = {
    server: 'Server', download: 'Download',
    compressed: 'Compressed', uncompressed: 'Uncompressed',
  };
  return `${format.platform} · ${pkgLabel[format.packaging] ?? format.packaging}`;
}
