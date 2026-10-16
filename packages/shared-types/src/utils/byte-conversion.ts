
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