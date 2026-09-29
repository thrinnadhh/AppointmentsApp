/**
 * privacy.ts
 *
 * Consumer privacy & data masking utilities complying with:
 *  - DPIIT E-Commerce Guidelines (Customer Contact Masking & PII Protection)
 *  - DPDPA 2023 (Digital Personal Data Protection Act — Data Minimisation & Purpose Limitation)
 *  - CCPA / Consumer Protection (E-Commerce) Rules 2020
 */

/**
 * Masks a customer phone number to protect consumer privacy against unwarranted harvesting,
 * off-platform poaching, and unsolicited outreach.
 *
 * Examples:
 *  - "+91 94401 23456"  -> "+91 94*** **456"
 *  - "+919440123456"   -> "+91 94*** **456"
 *  - "9440123456"      -> "94*****456"
 *  - "+91 877 2255667" -> "+91 87*** **667"
 *  - "Not provided"    -> "Not provided"
 */
export function maskPhoneNumber(phone?: string | null): string {
  if (!phone || typeof phone !== 'string') {
    return 'Not provided';
  }

  const trimmed = phone.trim();
  if (
    trimmed === '' ||
    trimmed.toLowerCase() === 'not provided' ||
    trimmed.toLowerCase() === 'null' ||
    trimmed.toLowerCase() === 'undefined'
  ) {
    return 'Not provided';
  }

  // Extract all digit characters
  const digits = trimmed.replace(/\D/g, '');

  // 1. Indian mobile with country code (+91 or 91 with 10 national digits = 12 digits)
  if (digits.length === 12 && digits.startsWith('91')) {
    const national = digits.slice(2);
    const prefix = national.slice(0, 2);
    const suffix = national.slice(-3);
    return `+91 ${prefix}*** **${suffix}`;
  }

  // 2. 10-digit mobile number
  if (digits.length === 10) {
    const prefix = digits.slice(0, 2);
    const suffix = digits.slice(-3);
    if (trimmed.includes('+91')) {
      return `+91 ${prefix}*** **${suffix}`;
    }
    return `${prefix}*****${suffix}`;
  }

  // 3. 11 digits starting with 0 (e.g. 09440123456)
  if (digits.length === 11 && digits.startsWith('0')) {
    const national = digits.slice(1);
    const prefix = national.slice(0, 2);
    const suffix = national.slice(-3);
    return `+91 ${prefix}*** **${suffix}`;
  }

  // 4. Generic fallback if length >= 7: keep first 4, last 3, mask middle
  if (trimmed.length >= 7) {
    const first = trimmed.slice(0, 4);
    const last = trimmed.slice(-3);
    return `${first}*****${last}`;
  }

  return '••••••••';
}

/**
 * Masks customer full name for public displays or privacy-first triage.
 * Keeps initial letter of surname or last name.
 *
 * Examples:
 *  - "P. Rajesh Kumar" -> "P. Rajesh K."
 *  - "Divya Teja"       -> "Divya T."
 *  - "Meghana"          -> "Meghana"
 */
export function maskCustomerName(name?: string | null): string {
  if (!name || typeof name !== 'string') {
    return 'Customer';
  }

  const trimmed = name.trim();
  if (
    trimmed === '' ||
    trimmed.toLowerCase() === 'walk-in / guest' ||
    trimmed.toLowerCase() === 'customer'
  ) {
    return trimmed || 'Customer';
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length <= 1) {
    return trimmed;
  }

  return parts
    .map((part, index) => {
      // If it's the last word and longer than 1 character, truncate to initial + period
      if (index === parts.length - 1 && part.length > 1) {
        return `${part[0]}.`;
      }
      return part;
    })
    .join(' ');
}
