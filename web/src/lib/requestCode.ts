const HALF = 4;

// "ab12cd34" -> "ab12-cd34": easier to compare between two screens.
export const formatRequestCode = (code: string): string => `${code.slice(0, HALF)}-${code.slice(HALF)}`;
