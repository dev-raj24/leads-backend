const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "12345678", "123456789", "1234567890", "qwerty123", "qwertyuiop",
  "iloveyou", "admin123", "welcome1", "welcome123", "letmein123", "abc12345", "11111111", "00000000", "leadworks", "leadworks1", "leadworks123",
  "changeme", "changeme123", "test1234", "india123", "india@123", "password@123",
]);

export function isWeakPassword(password: string, email?: string): boolean {
  if (password.length < 8 || password.length > 72) return true;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return true;
  if (/^(.)\1+$/.test(password)) return true;
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return true;
  return false;
}
