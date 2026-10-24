/** 12.3k, 1.2M: token counts that fit in a small label. */
export function compactTokens(count: number): string {
    if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(1)}M`;
    }
    return count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k` : String(count);
}

/** A cost with enough digits to show cents of a cent, as one request often costs less than a cent. */
export function formatCost(amount: number, currency = 'EUR'): string {
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: amount < 1 ? 4 : 2 }).format(amount);
    } catch {
        return `${amount.toFixed(4)} ${currency}`;
    }
}
