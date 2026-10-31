const IMAGEKIT_URL_ENDPOINT =
  process.env.IMAGEKIT_URL_ENDPOINT;

export function getAvatarUrl(
  avatarKey: string | null | undefined
): string | null {
  if (!avatarKey || !IMAGEKIT_URL_ENDPOINT) {
    return null;
  }

  const endpoint = IMAGEKIT_URL_ENDPOINT.replace(
    /\/$/,
    ""
  );

  const key = avatarKey.replace(/^\/+/, "");

  return `${endpoint}/${key}`;
}