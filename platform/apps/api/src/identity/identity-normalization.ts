import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { IdentityDocumentKind } from '@preneura/contracts/identity';

const arabicIndicDigits = '٠١٢٣٤٥٦٧٨٩';
const easternArabicDigits = '۰۱۲۳۴۵۶۷۸۹';

export interface NormalizedIdentityDocument {
  kind: IdentityDocumentKind;
  normalizedIdentifier: string;
  countryCode: string;
  displayHint: string;
}

export function normalizeEgyptPhone(value: string): string {
  const asciiInput = toAsciiDigits(value).trim();
  const phone = parsePhoneNumberFromString(asciiInput, 'EG');
  if (!phone?.isValid()) {
    throw new BadRequestException('Enter a valid phone number.');
  }
  return phone.number;
}

export function normalizeIdentityDocument(input: {
  kind: IdentityDocumentKind;
  identifier: string;
  countryCode?: string | null;
}): NormalizedIdentityDocument {
  if (input.kind === 'NATIONAL_ID') {
    const nationalId = toAsciiDigits(input.identifier).replace(/\D/g, '');
    validateEgyptNationalId(nationalId);
    return {
      kind: 'NATIONAL_ID',
      normalizedIdentifier: nationalId,
      countryCode: 'EG',
      displayHint: `••••••••••${nationalId.slice(-4)}`,
    };
  }

  const countryCode = (input.countryCode ?? 'EG').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new BadRequestException('Enter a valid two-letter passport country code.');
  }

  const passport = input.identifier
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '');
  if (!/^[A-Z0-9]{5,20}$/.test(passport)) {
    throw new BadRequestException('Enter a valid passport number.');
  }

  return {
    kind: 'PASSPORT',
    normalizedIdentifier: `${countryCode}:${passport}`,
    countryCode,
    displayHint: `${countryCode} ••••${passport.slice(-4)}`,
  };
}

export function toAsciiDigits(value: string): string {
  let result = '';
  for (const character of value) {
    const arabicIndex = arabicIndicDigits.indexOf(character);
    if (arabicIndex >= 0) {
      result += String(arabicIndex);
      continue;
    }
    const easternIndex = easternArabicDigits.indexOf(character);
    if (easternIndex >= 0) {
      result += String(easternIndex);
      continue;
    }
    result += character;
  }
  return result;
}

function validateEgyptNationalId(nationalId: string): void {
  if (!/^\d{14}$/.test(nationalId)) {
    throw new BadRequestException('Enter a valid 14-digit National ID.');
  }

  const centuryDigit = nationalId[0];
  if (centuryDigit !== '2' && centuryDigit !== '3') {
    throw new BadRequestException('Enter a structurally valid Egyptian National ID.');
  }

  const century = centuryDigit === '2' ? 1900 : 2000;
  const year = century + Number(nationalId.slice(1, 3));
  const month = Number(nationalId.slice(3, 5));
  const day = Number(nationalId.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date.getTime() > Date.now()
  ) {
    throw new BadRequestException('Enter a structurally valid Egyptian National ID.');
  }
}
