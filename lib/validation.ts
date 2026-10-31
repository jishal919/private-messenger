export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
export const MESSAGE_MAX = 4000;

const USERNAME_RE = /^[a-zA-Z0-9_.]+$/;

export function validateUsername(username: unknown): string | null {
  if (typeof username !== "string") return "Username is required.";
  const trimmed = username.trim();
  if (trimmed.length < USERNAME_MIN || trimmed.length > USERNAME_MAX) {
    return `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters.`;
  }
  if (!USERNAME_RE.test(trimmed)) {
    return "Username can only contain letters, numbers, underscores, and periods.";
  }
  return null;
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string") return "Password is required.";
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  }
  return null;
}

export function validateMessageContent(content: unknown): string | null {
  if (typeof content !== "string") return "Message content is required.";
  const trimmed = content.trim();
  if (trimmed.length === 0) return "Message cannot be empty.";
  if (content.length > MESSAGE_MAX) {
    return `Message must be ${MESSAGE_MAX} characters or fewer.`;
  }
  return null;
}

export function normalizeUsername(username: string): string {
  return username.trim();
}
