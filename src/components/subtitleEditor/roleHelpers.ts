/**
 * Utilities for fast role tagging: (М), (Ж), and auto-incremented numbering (№)
 */

// Regex patterns for gender prefixes
const MALE_PREFIX_REGEX = /^\s*\(М\)\s*/i;
const FEMALE_PREFIX_REGEX = /^\s*\(Ж\)\s*/i;

/**
 * Adds or switches the (М) or (Ж) gender prefix on a character/role name
 */
export function applyGenderPrefix(roleName: string, gender: 'M' | 'F'): string {
  let name = (roleName || '').trim();
  if (name === 'Default') name = '';

  // Strip existing gender prefix if any
  name = name.replace(MALE_PREFIX_REGEX, '').replace(FEMALE_PREFIX_REGEX, '').trim();

  const prefix = gender === 'M' ? '(М)' : '(Ж)';
  
  if (!name) {
    return prefix;
  }
  
  return `${prefix} ${name}`;
}

/**
 * Extracts the base name and current number from a role string
 */
export function parseRoleNameAndNumber(roleName: string): { baseName: string; currentNumber: number | null; format: 'suffix' | 'prefix' | 'none' } {
  let name = (roleName || '').trim();
  if (!name || name === 'Default') {
    return { baseName: '', currentNumber: null, format: 'none' };
  }

  // 1. Check for prefix number like "(1) Name", "(№1) Name", "№1 Name"
  const prefixMatch = name.match(/^(\(|№)?(\d+)(\))?\s+(.+)$/);
  if (prefixMatch) {
    const num = parseInt(prefixMatch[2], 10);
    const rest = prefixMatch[4].trim();
    return { baseName: rest, currentNumber: num, format: 'prefix' };
  }

  // 2. Check for suffix number like "Name 1", "Name #1", "Name (1)", "Name - 1"
  const suffixMatch = name.match(/^(.+?)(?:\s+|#|-|\()(\d+)\)?$/);
  if (suffixMatch) {
    const base = suffixMatch[1].trim();
    const num = parseInt(suffixMatch[2], 10);
    return { baseName: base, currentNumber: num, format: 'suffix' };
  }

  return { baseName: name, currentNumber: null, format: 'none' };
}

/**
 * Scans all roles in the current episode and computes the next sequential number for the given role
 */
export function getNextNumberedRole(currentRole: string, allEpisodeRoles: string[]): string {
  const current = (currentRole || '').trim();
  const parsed = parseRoleNameAndNumber(current);
  
  const baseName = parsed.baseName || current || 'Персонаж';
  const currentNum = parsed.currentNumber;

  // Find all used numbers for this base role across the episode
  const usedNumbers = new Set<number>();
  let preferredFormat: 'suffix' | 'prefix' = parsed.format !== 'none' ? parsed.format : 'suffix';

  for (const r of allEpisodeRoles) {
    if (!r) continue;
    const rTrimmed = r.trim();
    const p = parseRoleNameAndNumber(rTrimmed);
    if (p.baseName.toLowerCase() === baseName.toLowerCase() && p.currentNumber !== null) {
      usedNumbers.add(p.currentNumber);
      if (p.format !== 'none') {
        preferredFormat = p.format;
      }
    }
  }

  // Determine next number
  let nextNum = 1;
  if (currentNum !== null) {
    // If current line already has a number, increment past it
    nextNum = currentNum + 1;
    while (usedNumbers.has(nextNum)) {
      nextNum++;
    }
  } else {
    // Find smallest available positive integer or max + 1
    if (usedNumbers.size > 0) {
      const maxUsed = Math.max(...Array.from(usedNumbers));
      nextNum = maxUsed + 1;
    } else {
      nextNum = 1;
    }
  }

  if (preferredFormat === 'prefix') {
    return `(${nextNum}) ${baseName}`;
  } else {
    return `${baseName} ${nextNum}`;
  }
}
