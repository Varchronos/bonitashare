
type SizeUnit = 'B' | 'KB' | 'MB' | 'GB' | 'TB' | 'PB';

const MULTIPLIERS: Record<SizeUnit, number> = {
    'B': 1,
    'KB': 1024,
    'MB': 1048576,
    'GB': 1073741824,
    'TB': 1099511627776,
    'PB': 1125899906842624,
};

export const toBytes = (quantity: number, unit: SizeUnit): number => {
    const multiplier = MULTIPLIERS[unit];
    if (multiplier === undefined) {
        throw new Error('unit conversion not supported for this size');
    }
    return quantity * multiplier;
};

export function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return `${value.toFixed(1)} ${units[i]}`;
}
