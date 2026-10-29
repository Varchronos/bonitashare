// Rough, for labelling sessions in a device list — never for anything security-relevant, since the
// header is the client's to set. Tablets first: Android tablets lack "Mobile", iPads say "iPad".
export function deviceTypeOf(userAgent: string | undefined): string | null {
    if (!userAgent) return null;
    if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(userAgent)) return 'tablet';
    if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(userAgent)) return 'mobile';
    return 'desktop';
}
