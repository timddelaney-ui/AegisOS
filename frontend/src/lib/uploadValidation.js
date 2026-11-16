export const UPLOAD_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp"];
export const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(",");
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** @returns {string|null} an error message, or null when the file is acceptable. */
export function validateUploadFile(file, { extraExtensions = [] } = {}) {
  if (!file) return "Pick a file";
  if (file.size > UPLOAD_MAX_BYTES) return `Too big (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 25 MB.`;
  const ext = (String(file.name || "").split(".").pop() || "").toLowerCase();
  if (![...UPLOAD_EXTENSIONS, ...extraExtensions].includes(ext)) return "Only PDF, PNG, JPG, JPEG or WEBP.";
  return null;
}
